using MySqlConnector;
using static DbWeb.Api.TableAccess;

namespace DbWeb.Api;

public static class RecordPresentation
{
    public static async Task Decorate(
        AppDb db,
        HttpContext ctx,
        int id,
        MySqlConnection c,
        DatabaseService s,
        List<LayoutField> fields,
        RecordPage result
    )
    {
        foreach (var field in fields.Where(f => f.Widget == "lookup" && f.Lookup != null))
        {
            try
            {
                await Access(db, ctx, id, field.Lookup!.Table, "read");
            }
            catch (ApiError e) when (e.Status == 403)
            {
                continue;
            }
            var labels = await s.LookupLabels(
                c,
                field.Lookup!,
                result.Rows.Select(r => r.Values.GetValueOrDefault(field.Name))
            );
            foreach (var row in result.Rows)
                if (
                    row.Values.GetValueOrDefault(field.Name) is { } key
                    && labels.TryGetValue(DatabaseService.KeyText(key), out var label)
                )
                    row.DisplayValues[field.Name] = label;
        }
        LayoutRules.AddDropdownLabels(fields, result.Rows);
        result.JoinedColumns.AddRange(
            await PopulateJoins(db, ctx, id, c, s, fields, result.Columns, result.Rows)
        );
    }

    public static async Task<List<ColumnInfo>> PopulateJoins(
        AppDb db,
        HttpContext ctx,
        int id,
        MySqlConnection c,
        DatabaseService service,
        List<LayoutField> fields,
        List<ColumnInfo> sourceColumns,
        List<RecordRow> rows
    )
    {
        var result = new List<ColumnInfo>();
        foreach (var field in fields.Where(f => f.Widget == "join" && f.Join != null))
        {
            var join = field.Join!;
            try
            {
                await Access(db, ctx, id, join.Table, "read");
            }
            catch (ApiError e) when (e.Status == 403)
            {
                result.Add(new(field.Name, "text", true, false, true, false, null));
                continue;
            }
            var column = await service.ValidateJoin(c, join, sourceColumns);
            result.Add(
                column with
                {
                    Name = field.Name,
                    Nullable = true,
                    PrimaryKey = false,
                    Generated = true,
                    AutoIncrement = false,
                    Default = null,
                }
            );
            var joined = await service.JoinValues(
                c,
                join,
                rows.Select(r => r.Values.GetValueOrDefault(join.SourceColumn))
            );
            foreach (var row in rows)
                row.JoinedValues[field.Name] = row.Values.GetValueOrDefault(join.SourceColumn)
                    is { } key
                    ? joined.GetValueOrDefault(DatabaseService.KeyText(key))
                    : null;
        }
        result.AddRange(Formulas.Populate(fields, sourceColumns, rows));
        return result;
    }
}
