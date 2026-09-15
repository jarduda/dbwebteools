using MySqlConnector;

namespace DbWeb.Api;

public partial class DatabaseService
{
    public async Task<ColumnInfo> ValidateJoin(
        MySqlConnection db,
        JoinConfig join,
        List<ColumnInfo> sourceColumns
    )
    {
        var source =
            sourceColumns.Find(c => c.Name == join.SourceColumn)
            ?? throw new ApiError(400, "Join source must be an existing column in this table.");
        var columns = await ValidateLookup(
            db,
            new(join.Table, join.KeyColumn, join.ValueColumn, [])
        );
        if (
            TypeFamily(source.Type)
            != TypeFamily(columns.Single(c => c.Name == join.KeyColumn).Type)
        )
            throw new ApiError(400, "Join source and target key must have compatible types.");
        return columns.Single(c => c.Name == join.ValueColumn);
    }

    // At most one data query per joined field for a full page. The unique target key
    // prevents fan-out; unmatched keys are preserved by LEFT JOIN and yield NULL.
    // Returning the requested key also respects case-insensitive database collations.
    public async Task<Dictionary<string, object?>> JoinValues(
        MySqlConnection db,
        JoinConfig join,
        IEnumerable<object?> values
    )
    {
        var keys = values.Where(v => v != null).Select(KeyText).Distinct().ToList();
        if (keys.Count > 100)
            throw new ApiError(400, "Resolve at most 100 join keys at once.");
        var result = new Dictionary<string, object?>();
        if (keys.Count == 0)
            return result;
        await using var cmd = db.CreateCommand();
        for (var i = 0; i < keys.Count; i++)
            cmd.Parameters.AddWithValue("@k" + i, keys[i]);
        var requested = string.Join(
            " UNION ALL ",
            keys.Select((_, i) => $"SELECT @k{i} AS requested_key")
        );
        cmd.CommandText =
            $"SELECT q.requested_key, t.{Quote(join.ValueColumn)} AS joined_value FROM ({requested}) AS q LEFT JOIN {Quote(join.Table)} AS t ON t.{Quote(join.KeyColumn)}=q.requested_key";
        foreach (var row in await Read(cmd))
            result[KeyText(row["requested_key"])] = row["joined_value"];
        return result;
    }
}
