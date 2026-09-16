using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MySqlConnector;
using static DbWeb.Api.TableAccess;

namespace DbWeb.Api;

public class PageConfiguration
{
    public int Id { get; set; }
    public int ConnectionId { get; set; }
    public string Table { get; set; } = "";
    public string Name { get; set; } = "";
    public string LinkColumn { get; set; } = "";
    public string TabsJson { get; set; } = "[]";
}

public record RelatedTab(
    string Id,
    string Label,
    string Table,
    string ParentColumn,
    string RelatedColumn,
    List<string> Columns,
    int? TargetPageId = null,
    string? LinkColumn = null
);

public record PageDefinition(
    int Id,
    int ConnectionId,
    string Table,
    string Name,
    string LinkColumn,
    List<RelatedTab> Tabs
);

public static class PageSchema
{
    // Additive, idempotent upgrade for existing EnsureCreated databases. Never recreate metadata.
    public static void EnsureCreated(AppDb db) =>
        db.Database.ExecuteSqlRaw(
            """
            CREATE TABLE IF NOT EXISTS "Pages" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_Pages" PRIMARY KEY AUTOINCREMENT,
                "ConnectionId" INTEGER NOT NULL, "Table" TEXT NOT NULL, "Name" TEXT NOT NULL,
                "LinkColumn" TEXT NOT NULL, "TabsJson" TEXT NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_Pages_ConnectionId_Table_LinkColumn"
                ON "Pages" ("ConnectionId", "Table", "LinkColumn");
            """
        );
}

public partial class DatabaseService
{
    public async Task<RecordPage> PageRecord(MySqlConnection db, string table, string keyJson)
    {
        var columns = await Columns(db, table);
        var keys = columns.Where(c => c.PrimaryKey).ToList();
        Dictionary<string, JsonElement>? key;
        try
        {
            key =
                keyJson.Length <= 8192
                    ? JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(keyJson)
                    : null;
        }
        catch (JsonException)
        {
            throw new ApiError(400, "Invalid record key.");
        }
        if (
            keys.Count == 0
            || key == null
            || key.Count != keys.Count
            || keys.Any(c => !key.ContainsKey(c.Name))
        )
            throw new ApiError(400, "Complete primary key required.");
        await using var cmd = db.CreateCommand();
        var predicates = new List<string>();
        foreach (var column in keys)
        {
            var value = key[column.Name];
            if (value.ValueKind is not JsonValueKind.String and not JsonValueKind.Number)
                throw new ApiError(400, "Record key values must be strings or numbers.");
            var parameter = "@key" + predicates.Count;
            predicates.Add(
                $"{Quote(column.Name)} = {FilterOperand(cmd, parameter, column, value.ToString())}"
            );
        }
        cmd.CommandText =
            $"SELECT * FROM {Quote(table)} WHERE {string.Join(" AND ", predicates)} LIMIT 1";
        var records = await Read(cmd);
        if (records.Count == 0)
            throw new ApiError(404, "Record no longer exists.");
        return new(1, 1, 1, columns, records.Select(r => new RecordRow(r, Version(r))).ToList());
    }
}

public static class PageEndpoints
{
    static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    static PageDefinition Definition(PageConfiguration page) =>
        new(
            page.Id,
            page.ConnectionId,
            page.Table,
            page.Name,
            page.LinkColumn,
            JsonSerializer.Deserialize<List<RelatedTab>>(page.TabsJson, Json) ?? []
        );

    static async Task<LayoutDefinition> Layout(AppDb db, int connection, string table) =>
        DatabaseService.Layout(
            (
                await db.Layouts.SingleOrDefaultAsync(l =>
                    l.ConnectionId == connection && l.Table == table
                )
            )?.FieldsJson
        );

    static async Task<bool> CanRead(AppDb db, HttpContext ctx, int connection, string table)
    {
        try
        {
            await Access(db, ctx, connection, table, "read");
            return true;
        }
        catch (ApiError e) when (e.Status == 403)
        {
            return false;
        }
    }

    static string Family(ColumnInfo c) =>
        DatabaseService.TextFilterColumn(c)
            ? "text"
            : c.Type switch
            {
                "tinyint"
                or "smallint"
                or "mediumint"
                or "int"
                or "bigint"
                or "year"
                or "bit"
                or "decimal"
                or "float"
                or "double" => "number",
                "datetime" or "timestamp" => "datetime",
                "date" => "date",
                _ => "unsupported",
            };

    static void Label(string? label)
    {
        if (string.IsNullOrWhiteSpace(label) || label.Length > 150 || label != label.Trim())
            throw new ApiError(
                400,
                "Page and tab names need 1–150 characters without surrounding spaces."
            );
    }

    static async Task Validate(PageDefinition input, AppDb db, DatabaseService service)
    {
        Label(input.Name);
        var config =
            await db.Connections.FindAsync(input.ConnectionId)
            ?? throw new ApiError(404, "Connection not found.");
        await using var c = await service.Open(config);
        var main = await service.Columns(c, input.Table);
        if (
            !main.Any(col => col.PrimaryKey)
            || main.Where(col => col.PrimaryKey).Any(col => Family(col) == "unsupported")
        )
            throw new ApiError(400, "Pages require a table with scalar primary-key columns.");
        if (!main.Any(col => col.Name == input.LinkColumn))
            throw new ApiError(400, "Choose a stored drill-down column.");
        if (
            input.Tabs == null
            || input.Tabs.Count > 12
            || input.Tabs.Any(t => t == null)
            || input.Tabs.Select(t => t.Id).Distinct().Count() != input.Tabs.Count
        )
            throw new ApiError(400, "Define at most 12 uniquely identified related tabs.");
        foreach (var tab in input.Tabs)
        {
            Label(tab.Label);
            if (!Guid.TryParse(tab.Id, out _))
                throw new ApiError(400, "Invalid tab identifier.");
            var related = await service.Columns(c, tab.Table);
            var parentColumn = main.Find(col => col.Name == tab.ParentColumn);
            var childColumn = related.Find(col => col.Name == tab.RelatedColumn);
            if (
                parentColumn == null
                || childColumn == null
                || Family(parentColumn) == "unsupported"
                || Family(parentColumn) != Family(childColumn)
            )
                throw new ApiError(
                    400,
                    "Select compatible stored parent and related columns for each tab."
                );
            var layout = await Layout(db, input.ConnectionId, tab.Table);
            var available = related
                .Select(col => col.Name)
                .Concat(
                    layout.Fields.Where(f => f.Widget is "join" or "formula").Select(f => f.Name)
                )
                .ToHashSet();
            if (
                tab.Columns is not { Count: > 0 and <= 100 }
                || tab.Columns.Distinct().Count() != tab.Columns.Count
                || tab.Columns.Any(name => !available.Contains(name))
            )
                throw new ApiError(
                    400,
                    "Select 1–100 distinct existing columns for each related list."
                );
            if (tab.TargetPageId != null)
            {
                var target =
                    tab.TargetPageId == input.Id && input.Id > 0 ? input
                    : await db.Pages.FindAsync(tab.TargetPageId) is { } stored ? Definition(stored)
                    : null;
                if (
                    target == null
                    || target.ConnectionId != input.ConnectionId
                    || target.Table != tab.Table
                )
                    throw new ApiError(
                        400,
                        "The destination page must belong to the related table and connection."
                    );
                if (tab.LinkColumn == null || !tab.Columns.Contains(tab.LinkColumn))
                    throw new ApiError(
                        400,
                        "Select a visible drill-down column for the related list."
                    );
            }
            else if (!string.IsNullOrEmpty(tab.LinkColumn))
                throw new ApiError(
                    400,
                    "Select a destination page before a related drill-down column."
                );
        }
    }

    public static void Map(WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/pages").RequireAuthorization("Admin");
        admin.MapGet(
            "",
            async (AppDb db) =>
                (await db.Pages.OrderBy(p => p.Name).ToListAsync()).Select(Definition)
        );
        admin.MapPost(
            "",
            async (PageDefinition input, AppDb db, DatabaseService service) =>
            {
                input = input with { Id = 0 };
                await Validate(input, db, service);
                var page = new PageConfiguration
                {
                    ConnectionId = input.ConnectionId,
                    Table = input.Table,
                    Name = input.Name,
                    LinkColumn = input.LinkColumn,
                    TabsJson = JsonSerializer.Serialize(input.Tabs),
                };
                db.Pages.Add(page);
                await db.SaveChangesAsync();
                return Results.Ok(Definition(page));
            }
        );
        admin.MapPut(
            "/{id:int}",
            async (int id, PageDefinition input, AppDb db, DatabaseService service) =>
            {
                var page =
                    await db.Pages.FindAsync(id) ?? throw new ApiError(404, "Page not found.");
                if (input.ConnectionId != page.ConnectionId || input.Table != page.Table)
                    throw new ApiError(
                        400,
                        "A saved page's connection and table cannot change. Create a new page instead."
                    );
                input = input with { Id = id };
                await Validate(input, db, service);
                page.Name = input.Name;
                page.LinkColumn = input.LinkColumn;
                page.TabsJson = JsonSerializer.Serialize(input.Tabs);
                await db.SaveChangesAsync();
                return Results.NoContent();
            }
        );
        admin.MapDelete(
            "/{id:int}",
            async (int id, AppDb db) =>
            {
                var page =
                    await db.Pages.FindAsync(id) ?? throw new ApiError(404, "Page not found.");
                if (
                    (await db.Pages.Where(p => p.Id != id).ToListAsync()).Any(p =>
                        Definition(p).Tabs.Any(t => t.TargetPageId == id)
                    )
                )
                    throw new ApiError(
                        409,
                        "Remove links to this page from other pages before deleting it."
                    );
                db.Pages.Remove(page);
                await db.SaveChangesAsync();
                return Results.NoContent();
            }
        );
        var api = app.MapGroup("/api/pages").RequireAuthorization();
        api.MapGet(
            "",
            async (AppDb db, HttpContext ctx) =>
            {
                var result = new List<object>();
                foreach (var page in await db.Pages.OrderBy(p => p.Name).ToListAsync())
                    if (await CanRead(db, ctx, page.ConnectionId, page.Table))
                        result.Add(
                            new
                            {
                                page.Id,
                                page.ConnectionId,
                                page.Table,
                                page.Name,
                                page.LinkColumn,
                            }
                        );
                return result;
            }
        );
        api.MapGet(
            "/{id:int}/record",
            async (int id, string key, AppDb db, DatabaseService service, HttpContext ctx) =>
            {
                var page =
                    await db.Pages.FindAsync(id) ?? throw new ApiError(404, "Page not found.");
                var config = await Access(db, ctx, page.ConnectionId, page.Table, "read");
                await using var c = await service.Open(config);
                var records = await service.PageRecord(c, page.Table, key);
                var layout = await Layout(db, page.ConnectionId, page.Table);
                await RecordPresentation.Decorate(
                    db,
                    ctx,
                    page.ConnectionId,
                    c,
                    service,
                    layout.Fields,
                    records
                );
                var tabs = new List<RelatedTab>();
                foreach (var tab in Definition(page).Tabs)
                    if (await CanRead(db, ctx, page.ConnectionId, tab.Table))
                        tabs.Add(tab);
                var uid = int.Parse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
                var canUpdate =
                    ctx.User.IsInRole("Admin")
                    || await db.Grants.AnyAsync(g =>
                        g.UserId == uid
                        && g.ConnectionId == page.ConnectionId
                        && g.Table == page.Table
                        && g.Update
                        && g.Read
                    );
                return new
                {
                    page = Definition(page) with
                    {
                        Tabs = tabs,
                    },
                    record = records.Rows[0],
                    columns = records.Columns.Concat(records.JoinedColumns),
                    fields = layout.Fields,
                    canUpdate,
                };
            }
        );
        api.MapGet(
            "/{id:int}/tabs/{tabId}/records",
            async (
                int id,
                string tabId,
                string key,
                int? page,
                int? size,
                string? search,
                string? sort,
                bool? descending,
                AppDb db,
                DatabaseService service,
                HttpContext ctx
            ) =>
            {
                var configPage =
                    await db.Pages.FindAsync(id) ?? throw new ApiError(404, "Page not found.");
                var config = await Access(
                    db,
                    ctx,
                    configPage.ConnectionId,
                    configPage.Table,
                    "read"
                );
                var tab =
                    Definition(configPage).Tabs.SingleOrDefault(t => t.Id == tabId)
                    ?? throw new ApiError(404, "Related tab not found.");
                await Access(db, ctx, configPage.ConnectionId, tab.Table, "read");
                if (search?.Length > 200)
                    throw new ApiError(400, "Search is limited to 200 characters.");
                await using var c = await service.Open(config);
                var parent = await service.PageRecord(c, configPage.Table, key);
                if (!parent.Columns.Any(col => col.Name == tab.ParentColumn))
                    throw new ApiError(400, "Parent relationship column no longer exists.");
                var value = parent.Rows[0].Values.GetValueOrDefault(tab.ParentColumn);
                var layout = await Layout(db, configPage.ConnectionId, tab.Table);
                var result = await service.List(
                    c,
                    tab.Table,
                    page ?? 1,
                    size ?? 25,
                    sort,
                    descending ?? false,
                    search,
                    layout.View,
                    layout.Fields,
                    new ListFilter(tab.RelatedColumn, "eq", DatabaseService.KeyText(value)),
                    value == null
                );
                await RecordPresentation.Decorate(
                    db,
                    ctx,
                    configPage.ConnectionId,
                    c,
                    service,
                    layout.Fields,
                    result
                );
                var available = result
                    .Columns.Concat(result.JoinedColumns)
                    .Select(col => col.Name)
                    .ToHashSet();
                return new
                {
                    data = result,
                    fields = layout.Fields,
                    visibleColumns = tab.Columns.Where(available.Contains),
                    targetPageId = tab.TargetPageId,
                    linkColumn = tab.LinkColumn,
                };
            }
        );
    }
}
