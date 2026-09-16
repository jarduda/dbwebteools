using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using MySqlConnector;

namespace DbWeb.Api;

public record ListFilter(string Column, string Operator, string? Value = null);

public record ListView(
    string? Label = null,
    string? Sort = null,
    bool Descending = false,
    string Match = "all",
    List<ListFilter>? Filters = null
);

public record LayoutDefinition(
    List<LayoutField> Fields,
    ListView? View = null,
    bool SumupsPending = false
);

public partial class DatabaseService
{
    static readonly JsonSerializerOptions LayoutJson = new() { PropertyNameCaseInsensitive = true };

    public static LayoutDefinition Layout(string? json)
    {
        using var document = JsonDocument.Parse(json ?? "[]");
        return ParseLayout(document.RootElement);
    }

    public static LayoutDefinition ParseLayout(JsonElement json)
    {
        try
        {
            var result =
                json.ValueKind == JsonValueKind.Array
                    ? new LayoutDefinition(json.Deserialize<List<LayoutField>>(LayoutJson)!)
                : json.ValueKind == JsonValueKind.Object
                    ? json.Deserialize<LayoutDefinition>(LayoutJson)
                : null;
            if (result?.Fields == null || result.Fields.Any(f => f == null))
                throw new ApiError(400, "Layout fields are required.");
            return result;
        }
        catch (JsonException)
        {
            throw new ApiError(400, "Invalid layout configuration.");
        }
    }

    public static bool TextFilterColumn(ColumnInfo c) =>
        c.Type
            is "char"
                or "varchar"
                or "tinytext"
                or "text"
                or "mediumtext"
                or "longtext"
                or "enum"
                or "set";

    // Bound parameters only. CAST precision/scale are derived from validated numeric input,
    // preserving BIGINT and decimal values instead of converting them through floating point.
    static string FilterOperand(MySqlCommand command, string name, ColumnInfo column, string value)
    {
        if (
            column.Type
            is "tinyint"
                or "smallint"
                or "mediumint"
                or "int"
                or "bigint"
                or "year"
                or "bit"
                or "decimal"
                or "numeric"
        )
        {
            var integer = column.Type is not "decimal" and not "numeric";
            if (!Regex.IsMatch(value, integer ? @"^[+-]?[0-9]+$" : @"^[+-]?[0-9]+(?:\.[0-9]+)?$"))
                throw new ApiError(
                    400,
                    $"Filter for {column.Name} requires a valid {(integer ? "integer" : "decimal number")}."
                );
            var scale = value.Contains('.') ? value.Length - value.IndexOf('.') - 1 : 0;
            if (value.Count(char.IsDigit) > 65 || scale > 30)
                throw new ApiError(
                    400,
                    "Numeric filters support up to 65 digits and 30 decimal places."
                );
            command.Parameters.AddWithValue(name, value);
            return $"CAST({name} AS DECIMAL(65,{scale}))";
        }
        if (column.Type is "float" or "double" or "real")
        {
            if (
                !double.TryParse(
                    value,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out var number
                ) || !double.IsFinite(number)
            )
                throw new ApiError(400, $"Filter for {column.Name} requires a finite number.");
            command.Parameters.AddWithValue(name, number);
        }
        else if (column.Type is "date" or "datetime" or "timestamp")
            command.Parameters.AddWithValue(
                name,
                Value(JsonSerializer.SerializeToElement(value), column)
            );
        else if (TextFilterColumn(column))
            command.Parameters.AddWithValue(name, value);
        else
            throw new ApiError(400, $"{column.Name} supports only empty/non-empty (NULL) filters.");
        return name;
    }

    public static string ViewPredicate(
        MySqlCommand command,
        ListView? view,
        List<ColumnInfo> columns
    )
    {
        if (view == null)
            return "";
        if (view.Label?.Length > 150 || (view.Label != null && view.Label != view.Label.Trim()))
            throw new ApiError(
                400,
                "List label must be at most 150 characters without surrounding spaces."
            );
        if (!string.IsNullOrEmpty(view.Sort) && !columns.Any(c => c.Name == view.Sort))
            throw new ApiError(400, "Choose a stored column for default sorting.");
        if (view.Match is not "all" and not "any" || view.Filters?.Count > 20)
            throw new ApiError(400, "Use match all/any with at most 20 filters.");
        var parts = new List<string>();
        foreach (var filter in view.Filters ?? [])
        {
            var col =
                columns.Find(c => c.Name == filter?.Column)
                ?? throw new ApiError(400, "Choose a stored column for each filter.");
            var name = "@filter" + parts.Count;
            var column = Quote(col.Name);
            if (filter!.Operator is "isNull" or "notNull")
            {
                parts.Add($"{column} IS {(filter.Operator == "notNull" ? "NOT " : "")}NULL");
                continue;
            }
            if (filter.Value == null || filter.Value.Length > 2000)
                throw new ApiError(400, "Filter value is required (maximum 2000 characters).");
            if (filter.Operator is "contains" or "startsWith")
            {
                if (!TextFilterColumn(col))
                    throw new ApiError(400, "Contains/starts with filters require text columns.");
                var escaped = filter.Value.Replace("!", "!!").Replace("%", "!%").Replace("_", "!_");
                command.Parameters.AddWithValue(
                    name,
                    (filter.Operator == "contains" ? "%" : "") + escaped + "%"
                );
                parts.Add($"{column} LIKE {name} ESCAPE '!'");
                continue;
            }
            var op = filter.Operator switch
            {
                "eq" => "=",
                "ne" => "<>",
                "gt" => ">",
                "gte" => ">=",
                "lt" => "<",
                "lte" => "<=",
                _ => throw new ApiError(400, "Unsupported filter operator."),
            };
            parts.Add($"{column} {op} {FilterOperand(command, name, col, filter.Value)}");
        }
        return parts.Count == 0
            ? ""
            : "(" + string.Join(view.Match == "any" ? " OR " : " AND ", parts) + ")";
    }
}
