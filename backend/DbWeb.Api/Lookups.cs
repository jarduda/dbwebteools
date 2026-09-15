using System.Globalization;
using System.Text.Json;
using MySqlConnector;

namespace DbWeb.Api;

public partial class DatabaseService
{
    public async Task<List<string>> LookupKeys(MySqlConnection db, string table)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText =
            "SELECT MIN(COLUMN_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@table AND NON_UNIQUE=0 GROUP BY INDEX_NAME HAVING COUNT(*)=1 AND MAX(SUB_PART) IS NULL";
        cmd.Parameters.AddWithValue("@table", table);
        await using var reader = await cmd.ExecuteReaderAsync();
        var keys = new List<string>();
        while (await reader.ReadAsync())
            keys.Add(reader.GetString(0));
        return keys.Distinct().ToList();
    }

    public async Task<List<ColumnInfo>> ValidateLookup(
        MySqlConnection db,
        LookupConfig lookup,
        ColumnInfo? source = null
    )
    {
        if (
            string.IsNullOrWhiteSpace(lookup.Table)
            || string.IsNullOrWhiteSpace(lookup.KeyColumn)
            || string.IsNullOrWhiteSpace(lookup.DisplayColumn)
            || lookup.SearchColumns == null
            || lookup.SearchColumns.Count > 12
        )
            throw new ApiError(
                400,
                "Choose a lookup table, key, display column, and at most 12 search columns."
            );
        var columns = await Columns(db, lookup.Table);
        var selected = lookup
            .SearchColumns.Append(lookup.KeyColumn)
            .Append(lookup.DisplayColumn)
            .Distinct()
            .ToList();
        if (
            selected.Any(n =>
                !columns.Any(c =>
                    c.Name == n
                    && !c.Type.Contains("blob")
                    && c.Type is not "binary" and not "varbinary" and not "geometry"
                )
            )
        )
            throw new ApiError(
                400,
                "Lookup columns must exist and contain searchable scalar values."
            );
        var key = columns.Single(c => c.Name == lookup.KeyColumn);
        if (key.Nullable || !(await LookupKeys(db, lookup.Table)).Contains(key.Name))
            throw new ApiError(
                400,
                "Lookup key must be a non-null, single-column primary or unique key."
            );
        if (
            source != null
            && (
                source.Generated
                || source.AutoIncrement
                || TypeFamily(source.Type) != TypeFamily(key.Type)
            )
        )
            throw new ApiError(
                400,
                "Lookup source must be writable and have a compatible key type."
            );
        return columns;
    }

    static string TypeFamily(string type) =>
        type switch
        {
            "tinyint" or "smallint" or "mediumint" or "int" or "bigint" => "integer",
            "varchar" or "char" => "string",
            _ => type,
        };

    public async Task<object> LookupSearch(
        MySqlConnection db,
        LookupConfig lookup,
        int page,
        int size,
        string? search
    )
    {
        await ValidateLookup(db, lookup);
        var names = new[] { lookup.KeyColumn, lookup.DisplayColumn }
            .Concat(lookup.SearchColumns)
            .Distinct()
            .ToList();
        page = Math.Max(1, page);
        size = Math.Clamp(size, 1, 100);
        if (search?.Length > 200)
            throw new ApiError(400, "Search is limited to 200 characters.");
        await using var cmd = db.CreateCommand();
        var where = "";
        if (!string.IsNullOrEmpty(search))
        {
            where =
                " WHERE "
                + string.Join(
                    " OR ",
                    names.Select(n => $"CAST({Quote(n)} AS CHAR) LIKE @search ESCAPE '!'")
                );
            cmd.Parameters.AddWithValue(
                "@search",
                "%" + search.Replace("!", "!!").Replace("%", "!%").Replace("_", "!_") + "%"
            );
        }
        cmd.CommandText = $"SELECT COUNT(*) FROM {Quote(lookup.Table)}{where}";
        var total = Convert.ToInt64(await cmd.ExecuteScalarAsync());
        cmd.CommandText =
            $"SELECT {string.Join(",", names.Select(Quote))} FROM {Quote(lookup.Table)}{where} ORDER BY {Quote(lookup.KeyColumn)} LIMIT @size OFFSET @offset";
        cmd.Parameters.AddWithValue("@size", size);
        cmd.Parameters.AddWithValue("@offset", (long)(page - 1) * size);
        return new
        {
            total,
            page,
            size,
            columns = names,
            rows = await Read(cmd),
        };
    }

    // One bounded query per lookup field, not one query per displayed row.
    public async Task<Dictionary<string, string?>> LookupLabels(
        MySqlConnection db,
        LookupConfig lookup,
        IEnumerable<object?> values
    )
    {
        await ValidateLookup(db, lookup);
        var keys = values.Where(v => v != null).Select(KeyText).Distinct().ToList();
        if (keys.Count > 100)
            throw new ApiError(400, "Resolve at most 100 keys at a time.");
        var result = new Dictionary<string, string?>();
        if (keys.Count == 0)
            return result;
        await using var cmd = db.CreateCommand();
        for (var i = 0; i < keys.Count; i++)
            cmd.Parameters.AddWithValue("@k" + i, keys[i]);
        cmd.CommandText =
            $"SELECT {Quote(lookup.KeyColumn)},{Quote(lookup.DisplayColumn)} FROM {Quote(lookup.Table)} WHERE {Quote(lookup.KeyColumn)} IN ({string.Join(",", keys.Select((_, i) => "@k" + i))})";
        foreach (var row in await Read(cmd))
            result[KeyText(row[lookup.KeyColumn])] = row[lookup.DisplayColumn]?.ToString();
        return result;
    }

    public static string KeyText(object? value) =>
        Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";

    public static List<LayoutField> LayoutFields(string? json) =>
        JsonSerializer.Deserialize<List<LayoutField>>(json ?? "[]") ?? [];
}
