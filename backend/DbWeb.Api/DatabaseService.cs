using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using MySqlConnector;

namespace DbWeb.Api;

public record ColumnInfo(
    string Name,
    string Type,
    bool Nullable,
    bool PrimaryKey,
    bool Generated,
    bool AutoIncrement,
    string? Default
);

public class DatabaseService(IDataProtectionProvider protection)
{
    public static string Quote(string name) => "`" + name.Replace("`", "``") + "`";

    public async Task<MySqlConnection> Open(DatabaseConnection c)
    {
        var cs = new MySqlConnectionStringBuilder
        {
            Server = c.Host,
            Port = c.Port,
            Database = c.Database,
            UserID = c.Username,
            Password = protection
                .CreateProtector("database-passwords")
                .Unprotect(c.ProtectedPassword),
            SslMode = c.VerifyTls ? MySqlSslMode.VerifyFull : MySqlSslMode.Disabled,
            AllowLoadLocalInfile = false,
            AllowUserVariables = false,
            ConnectionTimeout = 8,
            DefaultCommandTimeout = 20,
        };
        var db = new MySqlConnection(cs.ConnectionString);
        try
        {
            await db.OpenAsync();
            return db;
        }
        catch
        {
            await db.DisposeAsync();
            throw;
        }
    }

    public async Task<List<string>> Tables(MySqlConnection db)
    {
        await using var cmd = new MySqlCommand(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
            db
        );
        await using var r = await cmd.ExecuteReaderAsync();
        var a = new List<string>();
        while (await r.ReadAsync())
            a.Add(r.GetString(0));
        return a;
    }

    public async Task<List<ColumnInfo>> Columns(MySqlConnection db, string table)
    {
        if (!(await Tables(db)).Contains(table, StringComparer.Ordinal))
            throw new ApiError(404, "Table not found.");
        await using var cmd = new MySqlCommand(
            "SELECT COLUMN_NAME,DATA_TYPE,IS_NULLABLE,COLUMN_KEY,EXTRA,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@table ORDER BY ORDINAL_POSITION",
            db
        );
        cmd.Parameters.AddWithValue("@table", table);
        await using var r = await cmd.ExecuteReaderAsync();
        var a = new List<ColumnInfo>();
        while (await r.ReadAsync())
            a.Add(
                new(
                    r.GetString(0),
                    r.GetString(1),
                    r.GetString(2) == "YES",
                    r.GetString(3) == "PRI",
                    r.GetString(4).Contains("GENERATED"),
                    r.GetString(4).Contains("auto_increment"),
                    r.IsDBNull(5) ? null : r.GetString(5)
                )
            );
        return a;
    }

    static object? Wire(object value) =>
        value switch
        {
            DBNull => null,
            byte[] bytes => Convert.ToBase64String(bytes),
            DateTime d => d.ToString("yyyy-MM-ddTHH:mm:ss.ffffff", CultureInfo.InvariantCulture),
            long or ulong or decimal => Convert.ToString(value, CultureInfo.InvariantCulture),
            _ => value,
        };

    public static string Version(Dictionary<string, object?> row) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(row))));

    static async Task<List<Dictionary<string, object?>>> Read(MySqlCommand cmd)
    {
        await using var r = await cmd.ExecuteReaderAsync();
        var rows = new List<Dictionary<string, object?>>();
        while (await r.ReadAsync())
        {
            var row = new Dictionary<string, object?>();
            for (int i = 0; i < r.FieldCount; i++)
                row[r.GetName(i)] = Wire(r.GetValue(i));
            rows.Add(row);
        }
        return rows;
    }

    public async Task<object> List(
        MySqlConnection db,
        string table,
        int page,
        int size,
        string? sort,
        bool descending,
        string? search
    )
    {
        var cols = await Columns(db, table);
        page = Math.Max(1, page);
        size = Math.Clamp(size, 1, 100);
        sort ??= cols.FirstOrDefault(x => x.PrimaryKey)?.Name ?? cols[0].Name;
        if (!cols.Any(x => x.Name == sort))
            throw new ApiError(400, "Unknown sort column.");
        await using var cmd = db.CreateCommand();
        var searchable = cols.Where(x =>
                new[] { "varchar", "char", "text", "mediumtext", "longtext" }.Contains(x.Type)
            )
            .ToList();
        string where = "";
        if (!string.IsNullOrEmpty(search) && searchable.Count > 0)
        {
            where =
                " WHERE "
                + string.Join(" OR ", searchable.Select(x => $"{Quote(x.Name)} LIKE @search"));
            cmd.Parameters.AddWithValue("@search", "%" + search + "%");
        }
        cmd.CommandText = $"SELECT COUNT(*) FROM {Quote(table)}{where}";
        var total = Convert.ToInt64(await cmd.ExecuteScalarAsync());
        cmd.CommandText =
            $"SELECT * FROM {Quote(table)}{where} ORDER BY {Quote(sort)} {(descending ? "DESC" : "ASC")} LIMIT @size OFFSET @offset";
        cmd.Parameters.AddWithValue("@size", size);
        cmd.Parameters.AddWithValue("@offset", checked((long)(page - 1) * size));
        var rows = await Read(cmd);
        return new
        {
            total,
            page,
            size,
            columns = cols,
            rows = rows.Select(x => new { values = x, version = Version(x) }),
        };
    }

    static object Value(JsonElement e, ColumnInfo col)
    {
        if (e.ValueKind == JsonValueKind.Null)
        {
            if (!col.Nullable)
                throw new ApiError(400, $"{col.Name} cannot be null.");
            return DBNull.Value;
        }
        if (e.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
            throw new ApiError(400, "Field values must be scalar.");
        if (col.Type.Contains("blob") || col.Type is "binary" or "varbinary")
            return Convert.FromBase64String(e.GetString() ?? "");
        return e.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => e.ToString(),
        };
    }

    public async Task Mutate(MySqlConnection db, string table, RowMutation input, string operation)
    {
        if (input.Values == null)
            throw new ApiError(400, "Values object required.");
        var cols = await Columns(db, table);
        if (!cols.Any(x => x.PrimaryKey))
            throw new ApiError(400, "Tables without a primary key are read-only.");
        foreach (var field in input.Values)
        {
            var col =
                cols.Find(x => x.Name == field.Key) ?? throw new ApiError(400, "Unknown column.");
            if (col.Generated || col.AutoIncrement || (operation == "update" && col.PrimaryKey))
                throw new ApiError(400, $"{col.Name} is read-only.");
        }
        if (operation == "update" && input.Values.Count == 0)
            throw new ApiError(400, "Provide at least one field.");
        await using var tx = await db.BeginTransactionAsync();
        await using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        string where = "";
        if (operation != "create")
        {
            var keys = cols.Where(x => x.PrimaryKey).ToList();
            if (keys.Count == 0)
                throw new ApiError(400, "Tables without a primary key are read-only.");
            if (
                input.Key == null
                || input.Key.Count != keys.Count
                || keys.Any(x => !input.Key.ContainsKey(x.Name))
            )
                throw new ApiError(400, "Complete primary key required.");
            where = string.Join(" AND ", keys.Select((x, i) => $"{Quote(x.Name)}=@k{i}"));
            for (int i = 0; i < keys.Count; i++)
                cmd.Parameters.AddWithValue("@k" + i, Value(input.Key[keys[i].Name], keys[i]));
            cmd.CommandText = $"SELECT * FROM {Quote(table)} WHERE {where} FOR UPDATE";
            var existing = await Read(cmd);
            if (existing.Count == 0)
                throw new ApiError(404, "Record no longer exists.");
            if (input.Version != Version(existing[0]))
                throw new ApiError(409, "This record changed. Refresh before saving.");
        }
        var names = input.Values.Keys.ToList();
        for (int i = 0; i < names.Count; i++)
            cmd.Parameters.AddWithValue(
                "@v" + i,
                Value(input.Values[names[i]], cols.First(x => x.Name == names[i]))
            );
        cmd.CommandText = operation switch
        {
            "create" =>
                $"INSERT INTO {Quote(table)} ({string.Join(",", names.Select(Quote))}) VALUES ({string.Join(",", names.Select((_, i) => "@v" + i))})",
            "update" =>
                $"UPDATE {Quote(table)} SET {string.Join(",", names.Select((n, i) => $"{Quote(n)}=@v{i}"))} WHERE {where}",
            _ => $"DELETE FROM {Quote(table)} WHERE {where}",
        };
        await cmd.ExecuteNonQueryAsync();
        await tx.CommitAsync();
    }
}
