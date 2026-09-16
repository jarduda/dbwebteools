using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MySqlConnector;
using static DbWeb.Api.TableAccess;

namespace DbWeb.Api;

public static class RecordWrites
{
    public static async Task<List<LayoutField>> Validate(
        AppDb db,
        HttpContext ctx,
        int id,
        string table,
        RowMutation input,
        string op,
        DatabaseService s,
        MySqlConnection c
    )
    {
        List<LayoutField> fields = [];
        if (op != "delete" && input.Values != null)
        {
            var layout = await db.Layouts.SingleOrDefaultAsync(x =>
                x.ConnectionId == id && x.Table == table
            );
            fields = DatabaseService.LayoutFields(layout?.FieldsJson);
            if (
                fields.Any(f =>
                    (f.Widget is "join" or "formula") && input.Values.ContainsKey(f.Name)
                )
            )
                throw new ApiError(
                    400,
                    "Computed fields are read-only and cannot be submitted as stored values."
                );
            foreach (
                var field in DatabaseService
                    .LayoutFields(layout?.FieldsJson)
                    .Where(f => f.Widget == "lookup" && f.Lookup != null)
            )
            {
                if (!input.Values.TryGetValue(field.Name, out var key))
                    continue;
                if (
                    key.ValueKind == JsonValueKind.Null
                    && field.Lookup!.CopyMappings is not { Count: > 0 }
                )
                    continue;
                await Access(db, ctx, id, field.Lookup!.Table, "read");
                if (key.ValueKind == JsonValueKind.Null)
                    continue;
                if (key.ValueKind is not JsonValueKind.Number and not JsonValueKind.String)
                    throw new ApiError(400, "Lookup keys must be strings or numbers.");
                var labels = await s.LookupLabels(
                    c,
                    field.Lookup,
                    new object?[] { key.ToString() }
                );
                if (!labels.ContainsKey(key.ToString()))
                    throw new ApiError(400, $"Select an existing related record for {field.Name}.");
            }
        }

        return fields;
    }
}
