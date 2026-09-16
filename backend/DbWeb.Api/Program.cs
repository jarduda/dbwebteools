using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using DbWeb.Api;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MySqlConnector;
using static DbWeb.Api.RecordPresentation;
using static DbWeb.Api.TableAccess;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<AppDb>(
    (services, o) =>
    {
        var data =
            services.GetRequiredService<IConfiguration>()["DataDirectory"]
            ?? Path.Combine(builder.Environment.ContentRootPath, "data");
        Directory.CreateDirectory(data);
        o.UseSqlite($"Data Source={Path.Combine(data, "app.db")}");
    }
);
builder.Services.AddDataProtection().SetApplicationName("DbWeb");
builder
    .Services.AddOptions<Microsoft.AspNetCore.DataProtection.KeyManagement.KeyManagementOptions>()
    .Configure<IConfiguration>(
        (o, c) =>
        {
            var path = Path.Combine(
                c["DataDirectory"] ?? Path.Combine(builder.Environment.ContentRootPath, "data"),
                "keys"
            );
            Directory.CreateDirectory(path);
            o.XmlRepository =
                new Microsoft.AspNetCore.DataProtection.Repositories.FileSystemXmlRepository(
                    new DirectoryInfo(path),
                    Microsoft.Extensions.Logging.Abstractions.NullLoggerFactory.Instance
                );
        }
    );
builder.Services.AddScoped<DatabaseService>();
builder.Services.AddScoped<PasswordHasher<AppUser>>();
builder.Services.AddAntiforgery(o =>
{
    o.HeaderName = "X-CSRF-TOKEN";
    o.Cookie.SameSite = SameSiteMode.Strict;
});
builder
    .Services.AddAuthentication("Cookies")
    .AddCookie(o =>
    {
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest
            : CookieSecurePolicy.Always;
        o.ExpireTimeSpan = TimeSpan.FromHours(8);
        o.Events.OnRedirectToLogin = c =>
        {
            c.Response.StatusCode = 401;
            return Task.CompletedTask;
        };
        o.Events.OnRedirectToAccessDenied = c =>
        {
            c.Response.StatusCode = 403;
            return Task.CompletedTask;
        };
        o.Events.OnValidatePrincipal = async c =>
        {
            var db = c.HttpContext.RequestServices.GetRequiredService<AppDb>();
            var u = await db.Users.FindAsync(
                int.Parse(c.Principal!.FindFirstValue(ClaimTypes.NameIdentifier)!)
            );
            if (u == null || !u.Enabled || u.Stamp != c.Principal!.FindFirstValue("stamp"))
                c.RejectPrincipal();
        };
    });
builder.Services.AddAuthorization(o => o.AddPolicy("Admin", p => p.RequireRole("Admin")));
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy(
        "login",
        c =>
            RateLimitPartition.GetFixedWindowLimiter(
                c.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ =>
                    new()
                    {
                        PermitLimit = 10,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    }
            )
    );
});
builder.Services.AddProblemDetails();
var app = builder.Build();
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    db.Database.EnsureCreated();
    PageSchema.EnsureCreated(db);
    if (!db.Users.Any())
    {
        var password = builder.Configuration["Bootstrap:Password"];
        if (string.IsNullOrEmpty(password) || password.Length < 14)
            throw new InvalidOperationException(
                "Set Bootstrap__Password to a unique password of at least 14 characters for first startup."
            );
        var u = new AppUser
        {
            Username = builder.Configuration["Bootstrap:Username"] ?? "admin",
            IsAdmin = true,
        };
        u.PasswordHash = new PasswordHasher<AppUser>().HashPassword(u, password);
        db.Users.Add(u);
        db.SaveChanges();
    }
}
app.UseExceptionHandler();
app.Use(
    async (c, next) =>
    {
        c.Response.Headers["X-Content-Type-Options"] = "nosniff";
        c.Response.Headers["X-Frame-Options"] = "DENY";
        c.Response.Headers["Referrer-Policy"] = "same-origin";
        c.Response.Headers.CacheControl = "no-store";
        try
        {
            await next();
        }
        catch (Exception ex)
            when (ex
                    is ApiError
                        or MySqlException
                        or AntiforgeryValidationException
                        or DbUpdateException
                        or FormatException
                        or OverflowException
            )
        {
            var status = ex switch
            {
                ApiError e => e.Status,
                AntiforgeryValidationException => 400,
                MySqlException m when m.Number == 1062 => 409,
                DbUpdateException => 409,
                _ => 400,
            };
            await Results
                .Problem(
                    statusCode: status,
                    title: ex is ApiError ? ex.Message
                        : ex is AntiforgeryValidationException ? "Invalid security token."
                        : "Operation failed. Check the values, connection, and database constraints."
                )
                .ExecuteAsync(c);
        }
    }
);
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.Use(
    async (c, next) =>
    {
        if (
            c.Request.Path.StartsWithSegments("/api")
            && !HttpMethods.IsGet(c.Request.Method)
            && !HttpMethods.IsHead(c.Request.Method)
        )
            await c.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(c);
        await next();
    }
);
app.MapGet("/health", () => new { status = "ok" });
app.MapGet(
    "/api/auth/csrf",
    (HttpContext c, IAntiforgery af) => new { token = af.GetAndStoreTokens(c).RequestToken }
);
app.MapPost(
        "/api/auth/login",
        async (LoginInput input, AppDb db, PasswordHasher<AppUser> hash, HttpContext c) =>
        {
            var u = await db.Users.SingleOrDefaultAsync(x => x.Username == input.Username);
            var dummy = new AppUser();
            var stored =
                u?.PasswordHash ?? hash.HashPassword(dummy, "constant-time-dummy-password");
            var valid = hash.VerifyHashedPassword(u ?? dummy, stored, input.Password);
            if (u == null || !u.Enabled || valid == PasswordVerificationResult.Failed)
                return Results.Unauthorized();
            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, u.Id.ToString()),
                new Claim(ClaimTypes.Name, u.Username),
                new Claim(ClaimTypes.Role, u.IsAdmin ? "Admin" : "User"),
                new Claim("stamp", u.Stamp),
            };
            await c.SignInAsync(
                "Cookies",
                new ClaimsPrincipal(new ClaimsIdentity(claims, "Cookies"))
            );
            return Results.Ok(
                new
                {
                    u.Id,
                    u.Username,
                    u.IsAdmin,
                }
            );
        }
    )
    .RequireRateLimiting("login");
app.MapPost(
        "/api/auth/logout",
        async (HttpContext c) =>
        {
            await c.SignOutAsync();
            return Results.NoContent();
        }
    )
    .RequireAuthorization();
app.MapGet(
        "/api/auth/me",
        (HttpContext c) =>
            new
            {
                id = int.Parse(c.User.FindFirstValue(ClaimTypes.NameIdentifier)!),
                username = c.User.Identity!.Name,
                isAdmin = c.User.IsInRole("Admin"),
            }
    )
    .RequireAuthorization();
var admin = app.MapGroup("/api/admin").RequireAuthorization("Admin");
admin.MapGet(
    "/users",
    async (AppDb db) =>
        await db
            .Users.Select(x => new
            {
                x.Id,
                x.Username,
                x.IsAdmin,
                x.Enabled,
            })
            .ToListAsync()
);
admin.MapPost(
    "/users",
    async (UserInput i, AppDb db, PasswordHasher<AppUser> h) =>
    {
        ValidateUser(i, true);
        var u = new AppUser
        {
            Username = i.Username.Trim(),
            IsAdmin = i.IsAdmin,
            Enabled = i.Enabled,
        };
        u.PasswordHash = h.HashPassword(u, i.Password!);
        db.Users.Add(u);
        await db.SaveChangesAsync();
        return Results.Ok(new { u.Id });
    }
);
admin.MapPut(
    "/users/{id:int}",
    async (int id, UserInput i, AppDb db, PasswordHasher<AppUser> h, HttpContext c) =>
    {
        ValidateUser(i, false);
        var u = await db.Users.FindAsync(id) ?? throw new ApiError(404, "User not found.");
        if (
            id == int.Parse(c.User.FindFirstValue(ClaimTypes.NameIdentifier)!)
            && (!i.Enabled || !i.IsAdmin)
        )
            throw new ApiError(400, "You cannot disable or demote your own account.");
        u.Username = i.Username.Trim();
        u.Enabled = i.Enabled;
        u.IsAdmin = i.IsAdmin;
        u.Stamp = Guid.NewGuid().ToString();
        if (!string.IsNullOrEmpty(i.Password))
            u.PasswordHash = h.HashPassword(u, i.Password);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }
);
admin.MapGet(
    "/connections",
    async (AppDb db) =>
        await db
            .Connections.Select(x => new
            {
                x.Id,
                x.Name,
                x.Host,
                x.Port,
                x.Database,
                x.Username,
                x.VerifyTls,
            })
            .ToListAsync()
);
admin.MapPost(
    "/connections",
    async (ConnectionInput i, AppDb db, IDataProtectionProvider p) =>
    {
        var c = new DatabaseConnection();
        SetConnection(c, i, p);
        db.Connections.Add(c);
        await db.SaveChangesAsync();
        return Results.Ok(new { c.Id });
    }
);
admin.MapPut(
    "/connections/{id:int}",
    async (int id, ConnectionInput i, AppDb db, IDataProtectionProvider p) =>
    {
        var c =
            await db.Connections.FindAsync(id) ?? throw new ApiError(404, "Connection not found.");
        SetConnection(c, i, p);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }
);
admin.MapDelete(
    "/connections/{id:int}",
    async (int id, AppDb db) =>
    {
        await db.Grants.Where(x => x.ConnectionId == id).ExecuteDeleteAsync();
        await db.Layouts.Where(x => x.ConnectionId == id).ExecuteDeleteAsync();
        await db.Pages.Where(x => x.ConnectionId == id).ExecuteDeleteAsync();
        await db.Connections.Where(x => x.Id == id).ExecuteDeleteAsync();
        return Results.NoContent();
    }
);
admin.MapPost(
    "/connections/{id:int}/test",
    async (int id, AppDb db, DatabaseService service) =>
    {
        await using var c = await service.Open(
            await db.Connections.FindAsync(id) ?? throw new ApiError(404, "Connection not found.")
        );
        return Results.Ok(new { tables = (await service.Tables(c)).Count });
    }
);
admin.MapGet("/grants", async (AppDb db) => await db.Grants.ToListAsync());
admin.MapPut(
    "/grants",
    async (TableGrant i, AppDb db, DatabaseService s) =>
    {
        if (!await db.Users.AnyAsync(x => x.Id == i.UserId))
            throw new ApiError(400, "Unknown user.");
        var c =
            await db.Connections.FindAsync(i.ConnectionId)
            ?? throw new ApiError(404, "Connection not found.");
        await using var conn = await s.Open(c);
        await s.Columns(conn, i.Table);
        var g = await db.Grants.SingleOrDefaultAsync(x =>
            x.UserId == i.UserId && x.ConnectionId == i.ConnectionId && x.Table == i.Table
        );
        if (g == null)
        {
            g = new()
            {
                UserId = i.UserId,
                ConnectionId = i.ConnectionId,
                Table = i.Table,
            };
            db.Grants.Add(g);
        }
        g.Read = i.Read;
        g.Create = i.Create;
        g.Update = i.Update;
        g.Delete = i.Delete;
        await db.SaveChangesAsync();
        return Results.NoContent();
    }
);
admin.MapGet(
    "/audit",
    async (AppDb db) => await db.Audit.OrderByDescending(x => x.Id).Take(200).ToListAsync()
);
var api = app.MapGroup("/api/connections").RequireAuthorization();
api.MapGet(
    "",
    async (AppDb db, HttpContext ctx) =>
    {
        var uid = int.Parse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        return await db
            .Connections.Where(x =>
                ctx.User.IsInRole("Admin")
                || db.Grants.Any(g => g.ConnectionId == x.Id && g.UserId == uid && g.Read)
            )
            .Select(x => new
            {
                x.Id,
                x.Name,
                x.Database,
            })
            .ToListAsync();
    }
);
api.MapGet(
    "/{id:int}/tables",
    async (int id, AppDb db, DatabaseService s, HttpContext ctx) =>
    {
        var uid = int.Parse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        if (
            !ctx.User.IsInRole("Admin")
            && !await db.Grants.AnyAsync(x => x.UserId == uid && x.ConnectionId == id && x.Read)
        )
            throw new ApiError(403, "Access denied.");
        await using var c = await s.Open(
            await db.Connections.FindAsync(id) ?? throw new ApiError(404, "Connection not found.")
        );
        var tables = await s.Tables(c);
        if (ctx.User.IsInRole("Admin"))
            return tables;
        var allowed = await db
            .Grants.Where(x => x.UserId == uid && x.ConnectionId == id && x.Read)
            .Select(x => x.Table)
            .ToListAsync();
        return tables.Intersect(allowed).ToList();
    }
);
api.MapGet(
    "/{id:int}/tables/{table}/records",
    async (
        int id,
        string table,
        int? page,
        int? size,
        string? sort,
        bool? descending,
        string? search,
        AppDb db,
        DatabaseService s,
        HttpContext ctx
    ) =>
    {
        var config = await Access(db, ctx, id, table, "read");
        await using var c = await s.Open(config);
        await Sumups.RepairIfPending(db, s, c, id);
        var layout = await db.Layouts.SingleOrDefaultAsync(x =>
            x.ConnectionId == id && x.Table == table
        );
        var definition = DatabaseService.Layout(layout?.FieldsJson);
        var result = await s.List(
            c,
            table,
            page ?? 1,
            size ?? 25,
            sort,
            descending ?? false,
            search,
            definition.View,
            definition.Fields
        );
        await Decorate(db, ctx, id, c, s, definition.Fields, result);
        return result;
    }
);
api.MapGet(
    "/{id:int}/tables/{table}/settings",
    async (int id, string table, AppDb db, HttpContext ctx) =>
    {
        await Access(db, ctx, id, table, "read");
        var uid = int.Parse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var grant = ctx.User.IsInRole("Admin")
            ? new TableGrant
            {
                Read = true,
                Create = true,
                Update = true,
                Delete = true,
            }
            : await db.Grants.SingleAsync(x =>
                x.UserId == uid && x.ConnectionId == id && x.Table == table
            );
        var l = await db.Layouts.SingleOrDefaultAsync(x =>
            x.ConnectionId == id && x.Table == table
        );
        return new
        {
            grant,
            fields = DatabaseService.LayoutFields(l?.FieldsJson),
            view = DatabaseService.Layout(l?.FieldsJson).View ?? new ListView(),
        };
    }
);
admin.MapPut(
    "/connections/{id:int}/tables/{table}/layout",
    async (int id, string table, JsonElement input, AppDb db, DatabaseService s) =>
    {
        await using var c = await s.Open(
            await db.Connections.FindAsync(id) ?? throw new ApiError(404, "Connection not found.")
        );
        await using var gate = await SumupGate.Enter(c);
        var definition = DatabaseService.ParseLayout(input) with { SumupsPending = false };
        var fields = definition.Fields;
        var cols = await s.Columns(c, table);
        using var validation = c.CreateCommand();
        DatabaseService.ViewPredicate(validation, definition.View, cols);
        if (fields.Any(f => f.Label == null || f.Label.Length > 150))
            throw new ApiError(400, "Field labels must be at most 150 characters.");
        if (
            fields.Select(x => x.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count()
                != fields.Count
            || fields.Count(x => x.Widget is "join" or "formula") > 20
            || fields.Any(x =>
                (x.Widget is not "join" and not "formula" && !cols.Any(y => y.Name == x.Name))
                || !new[]
                {
                    "auto",
                    "text",
                    "textarea",
                    "number",
                    "date",
                    "datetime",
                    "dropdown",
                    "checkbox",
                    "lookup",
                    "join",
                    "formula",
                    "sumup",
                }.Contains(x.Widget)
            )
        )
            throw new ApiError(400, "Invalid layout fields.");
        foreach (var field in fields)
        {
            if (field.Widget != "sumup" && field.Sumup != null)
                throw new ApiError(400, "Only sum-up fields can define sum-up configuration.");
            if (field.Widget is "join" or "formula")
            {
                if (
                    string.IsNullOrWhiteSpace(field.Name)
                    || field.Name.Length > 100
                    || field.Name != field.Name.Trim()
                    || cols.Any(col =>
                        col.Name.Equals(field.Name, StringComparison.OrdinalIgnoreCase)
                    )
                    || field.Required
                    || !field.ReadOnly
                    || field.Lookup != null
                    || field.Options is { Count: > 0 }
                )
                    throw new ApiError(
                        400,
                        "Computed fields must have a unique virtual name, be read-only, and have no editable control configuration."
                    );
                if (field.Widget == "formula")
                {
                    if (field.Join != null)
                        throw new ApiError(400, "Formula fields cannot define a join.");
                    Formulas.Compile(field.Formula, cols, fields);
                }
                else
                {
                    if (field.Formula != null)
                        throw new ApiError(400, "Only formula fields may define a formula.");
                    await s.ValidateJoin(
                        c,
                        field.Join ?? throw new ApiError(400, "Join configuration required."),
                        cols
                    );
                }
                continue;
            }
            if (field.Formula != null)
                throw new ApiError(400, "Only formula fields may define a formula.");
            if (field.Join != null)
                throw new ApiError(400, "Only joined fields may define a join.");
            LayoutRules.Validate(field, cols.Single(x => x.Name == field.Name));
            if (field.Widget == "lookup")
                await s.ValidateLookup(
                    c,
                    field.Lookup ?? throw new ApiError(400, "Lookup configuration required."),
                    cols.Single(x => x.Name == field.Name)
                );
            else if (field.Lookup != null)
                throw new ApiError(400, "Only lookup controls may have lookup configuration.");
        }
        await s.ValidateCopyMappings(c, fields, cols);
        var l = await db.Layouts.SingleOrDefaultAsync(x =>
            x.ConnectionId == id && x.Table == table
        );
        if (l == null)
        {
            l = new() { ConnectionId = id, Table = table };
            db.Layouts.Add(l);
        }
        // Legacy array clients edit fields without erasing newer list-view settings.
        if (input.ValueKind == JsonValueKind.Array)
            definition = definition with { View = DatabaseService.Layout(l.FieldsJson).View };
        await Sumups.SaveLayout(db, s, c, id, l, definition);
        return Results.NoContent();
    }
);
api.MapGet(
    "/{id:int}/tables/{table}/schema",
    async (int id, string table, AppDb db, DatabaseService s, HttpContext ctx) =>
    {
        var config = await Access(db, ctx, id, table, "read");
        await using var c = await s.Open(config);
        return new
        {
            columns = await s.Columns(c, table),
            lookupKeys = await s.LookupKeys(c, table),
        };
    }
);
api.MapGet(
    "/{id:int}/tables/{table}/lookups/{field}",
    async (
        int id,
        string table,
        string field,
        int? page,
        int? size,
        string? search,
        string? key,
        AppDb db,
        DatabaseService s,
        HttpContext ctx
    ) =>
    {
        var config = await Access(db, ctx, id, table, "read");
        var layout = await db.Layouts.SingleOrDefaultAsync(x =>
            x.ConnectionId == id && x.Table == table
        );
        var lookup =
            DatabaseService
                .LayoutFields(layout?.FieldsJson)
                .SingleOrDefault(f => f.Name == field && f.Widget == "lookup")
                ?.Lookup
            ?? throw new ApiError(404, "Lookup not configured.");
        await Access(db, ctx, id, lookup.Table, "read");
        await using var c = await s.Open(config);
        if (key != null)
        {
            var labels = await s.LookupLabels(c, lookup, new object?[] { key });
            return Results.Ok(
                new { found = labels.ContainsKey(key), label = labels.GetValueOrDefault(key) }
            );
        }
        return Results.Ok(await s.LookupSearch(c, lookup, page ?? 1, size ?? 25, search));
    }
);
api.MapPost(
    "/{id:int}/tables/{table}/lookups/{field}/copy",
    async (
        int id,
        string table,
        string field,
        LookupCopyInput input,
        AppDb db,
        DatabaseService s,
        HttpContext ctx
    ) =>
    {
        var config = await Access(db, ctx, id, table, "read");
        var layout = await db.Layouts.SingleOrDefaultAsync(x =>
            x.ConnectionId == id && x.Table == table
        );
        var fields = DatabaseService.LayoutFields(layout?.FieldsJson);
        var lookup =
            fields.SingleOrDefault(f => f.Name == field && f.Widget == "lookup")?.Lookup
            ?? throw new ApiError(404, "Lookup not configured.");
        await Access(db, ctx, id, lookup.Table, "read");
        await using var c = await s.Open(config);
        await s.ValidateCopyMappings(c, fields, await s.Columns(c, table));
        return new { values = await s.CopyLookupValues(c, lookup, input.Key) };
    }
);
api.MapPost(
    "/{id:int}/tables/{table}/joins/resolve",
    async (int id, string table, JoinInput input, AppDb db, DatabaseService s, HttpContext ctx) =>
    {
        var config = await Access(db, ctx, id, table, "read");
        await using var c = await s.Open(config);
        var columns = await s.Columns(c, table);
        if (
            input.Values == null
            || input.Values.Any(v =>
                !columns.Any(col => col.Name == v.Key)
                || v.Value.ValueKind
                    is not JsonValueKind.String
                        and not JsonValueKind.Number
                        and not JsonValueKind.Null
                        and not JsonValueKind.True
                        and not JsonValueKind.False
            )
        )
            throw new ApiError(400, "Provide scalar values for existing source columns.");
        var layout = await db.Layouts.SingleOrDefaultAsync(x =>
            x.ConnectionId == id && x.Table == table
        );
        var row = new RecordRow(
            input.Values.ToDictionary(
                v => v.Key,
                v =>
                    v.Value.ValueKind switch
                    {
                        JsonValueKind.Null => null,
                        JsonValueKind.True => (object?)1,
                        JsonValueKind.False => 0,
                        _ => v.Value.ToString(),
                    }
            ),
            ""
        );
        var joinedColumns = await PopulateJoins(
            db,
            ctx,
            id,
            c,
            s,
            DatabaseService.LayoutFields(layout?.FieldsJson),
            columns,
            [row]
        );
        return new
        {
            values = row.JoinedValues,
            columns = joinedColumns,
            calculationErrors = row.CalculationErrors,
        };
    }
);
foreach (var operation in new[] { "create", "update", "delete" })
{
    var op = operation;
    api.MapPost(
        "/{id:int}/tables/{table}/" + op,
        async (
            int id,
            string table,
            RowMutation input,
            AppDb db,
            DatabaseService s,
            HttpContext ctx
        ) =>
        {
            var config = await Access(db, ctx, id, table, op);
            await using var c = await s.Open(config);
            await using var gate = await SumupGate.Enter(c);
            var plans = await Sumups.Ready(db, s, c, id);
            var fields = await RecordWrites.Validate(db, ctx, id, table, input, op, s, c);
            await s.Mutate(c, table, input, op, fields, sumups: plans);
            db.Audit.Add(
                new()
                {
                    Actor = ctx.User.Identity!.Name!,
                    Action = op,
                    Resource = $"{id}/{table}",
                }
            );
            await db.SaveChangesAsync();
            return Results.NoContent();
        }
    );
}
admin.MapPost(
    "/connections/{id:int}/tables/{table}/formulas/validate",
    async (int id, string table, FormulaValidationInput input, AppDb db, DatabaseService service) =>
    {
        await using var c = await service.Open(
            await db.Connections.FindAsync(id) ?? throw new ApiError(404, "Connection not found.")
        );
        var fields = input.Fields ?? [];
        if (fields.Count > 200 || fields.Any(f => f == null))
            throw new ApiError(400, "Invalid draft layout fields.");
        Formulas.Compile(input.Formula, await service.Columns(c, table), fields);
        return Results.Ok(
            new
            {
                message = "Formula is valid. Syntax, column references and function arguments checked; results depend on record values.",
            }
        );
    }
);
admin.MapGet(
    "/connections/{id:int}/tables/{table}/sumups/relations",
    async (int id, string table, AppDb db, DatabaseService service) =>
    {
        await using var c = await service.Open(
            await db.Connections.FindAsync(id) ?? throw new ApiError(404, "Connection not found.")
        );
        var result = new List<object>();
        foreach (var layout in await db.Layouts.Where(l => l.ConnectionId == id).ToListAsync())
        {
            var fields = DatabaseService.LayoutFields(layout.FieldsJson);
            var relations = fields
                .Where(f => f.Widget == "lookup" && f.Lookup?.Table == table)
                .ToList();
            if (relations.Count == 0)
                continue;
            var columns = await service.Columns(c, layout.Table);
            var sources = columns
                .Where(col =>
                    Sumups.Numeric(col.Type)
                    && !fields.Any(f => f.Name == col.Name && f.Widget == "sumup")
                )
                .Select(col => new
                {
                    name = col.Name,
                    label = fields.Find(f => f.Name == col.Name)?.Label ?? col.Name,
                    formula = false,
                })
                .Concat(
                    fields
                        .Where(f => f.Widget == "formula")
                        .Select(f => new
                        {
                            name = f.Name,
                            label = f.Label,
                            formula = true,
                        })
                )
                .ToList();
            foreach (var field in relations)
                result.Add(
                    new
                    {
                        childTable = layout.Table,
                        lookupField = field.Name,
                        label = field.Label,
                        keyColumn = field.Lookup!.KeyColumn,
                        sources,
                    }
                );
        }
        return result;
    }
);
admin.MapPost(
    "/connections/{id:int}/tables/{table}/sumups/recalculate",
    async (int id, string table, AppDb db, DatabaseService service, HttpContext ctx) =>
    {
        await using var c = await service.Open(
            await db.Connections.FindAsync(id) ?? throw new ApiError(404, "Connection not found.")
        );
        await using var gate = await SumupGate.Enter(c);
        var plans = await Sumups.Ready(db, service, c, id);
        var selected = plans.Where(p => p.ParentTable == table).ToList();
        if (selected.Count == 0)
            throw new ApiError(400, "Save at least one sum-up on this layout first.");
        await using var tx = await c.BeginTransactionAsync();
        await service.RebuildSumups(c, tx, selected);
        await tx.CommitAsync();
        db.Audit.Add(
            new()
            {
                Actor = ctx.User.Identity!.Name!,
                Action = "recalculate sumups",
                Resource = $"{id}/{table}",
            }
        );
        await db.SaveChangesAsync();
        return Results.Ok(new { fields = selected.Count });
    }
);
PageEndpoints.Map(app);
app.Run();
static void ValidateUser(UserInput i, bool create)
{
    if (string.IsNullOrWhiteSpace(i.Username) || i.Username.Length > 100)
        throw new ApiError(400, "Username required (maximum 100 characters).");
    if ((create || !string.IsNullOrEmpty(i.Password)) && (i.Password?.Length ?? 0) < 14)
        throw new ApiError(400, "Passwords must contain at least 14 characters.");
}
static void SetConnection(DatabaseConnection c, ConnectionInput i, IDataProtectionProvider p)
{
    if (
        new[] { i.Name, i.Host, i.Database, i.Username }.Any(string.IsNullOrWhiteSpace)
        || i.Port is 0 or > 65535
    )
        throw new ApiError(400, "Complete all connection fields with a valid port.");
    if (c.Id == 0 && i.Password == null)
        throw new ApiError(400, "Password required.");
    c.Name = i.Name;
    c.Host = i.Host;
    c.Port = i.Port;
    c.Database = i.Database;
    c.Username = i.Username;
    c.VerifyTls = i.VerifyTls;
    if (i.Password != null)
        c.ProtectedPassword = p.CreateProtector("database-passwords").Protect(i.Password);
}

public partial class Program { }
