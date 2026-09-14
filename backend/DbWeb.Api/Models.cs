using Microsoft.EntityFrameworkCore;

namespace DbWeb.Api;

public class AppUser
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public bool IsAdmin { get; set; }
    public bool Enabled { get; set; } = true;
    public string Stamp { get; set; } = Guid.NewGuid().ToString();
}

public class DatabaseConnection
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Host { get; set; } = "";
    public uint Port { get; set; } = 3306;
    public string Database { get; set; } = "";
    public string Username { get; set; } = "";
    public string ProtectedPassword { get; set; } = "";
    public bool VerifyTls { get; set; } = true;
}

public class TableGrant
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int ConnectionId { get; set; }
    public string Table { get; set; } = "";
    public bool Read { get; set; }
    public bool Create { get; set; }
    public bool Update { get; set; }
    public bool Delete { get; set; }
}

public class RecordLayout
{
    public int Id { get; set; }
    public int ConnectionId { get; set; }
    public string Table { get; set; } = "";
    public string FieldsJson { get; set; } = "[]";
}

public record LayoutField(
    string Name,
    string Label,
    string Section,
    int Order,
    bool Hidden,
    bool ReadOnly,
    string Widget
);

public class AuditEntry
{
    public long Id { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public string Resource { get; set; } = "";
}

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<DatabaseConnection> Connections => Set<DatabaseConnection>();
    public DbSet<TableGrant> Grants => Set<TableGrant>();
    public DbSet<RecordLayout> Layouts => Set<RecordLayout>();
    public DbSet<AuditEntry> Audit => Set<AuditEntry>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<AppUser>().HasIndex(x => x.Username).IsUnique();
        b.Entity<TableGrant>()
            .HasIndex(x => new
            {
                x.UserId,
                x.ConnectionId,
                x.Table,
            })
            .IsUnique();
        b.Entity<RecordLayout>().HasIndex(x => new { x.ConnectionId, x.Table }).IsUnique();
    }
}

public record LoginInput(string Username, string Password);

public record UserInput(string Username, string? Password, bool IsAdmin, bool Enabled);

public record ConnectionInput(
    string Name,
    string Host,
    uint Port,
    string Database,
    string Username,
    string? Password,
    bool VerifyTls
);

public record RowMutation(
    Dictionary<string, System.Text.Json.JsonElement> Values,
    Dictionary<string, System.Text.Json.JsonElement>? Key,
    string? Version
);

public class ApiError(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
