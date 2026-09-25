using System.Text.Json;
using MySqlConnector;

namespace DbWeb.Api;

// A missing configuration means leave the column to its database default.
// Values are strings to preserve exact BIGINT/DECIMAL and local database times.
public record CreationDefault(string? Value = null, bool IsNull = false);

public partial class DatabaseService
{
    public static JsonElement DefaultValue(LayoutField field, ColumnInfo column)
    {
        var setting = field.CreationDefault!;
        if (
            column.Generated
            || column.AutoIncrement
            || field.Widget is "join" or "formula" or "sumup"
        )
            throw new ApiError(400, "Creation defaults require writable stored columns.");
        if (setting.IsNull)
        {
            if (!column.Nullable || field.Required)
                throw new ApiError(400, $"{field.Name} cannot default to NULL.");
            return JsonSerializer.SerializeToElement<object?>(null);
        }
        if (setting.Value == null || setting.Value.Length > 4000)
            throw new ApiError(400, "Default value is required (maximum 4000 characters).");
        JsonElement value;
        if (field.Widget == "checkbox")
        {
            if (!bool.TryParse(setting.Value, out var boolean))
                throw new ApiError(400, $"Default for {field.Name} must be true or false.");
            value = JsonSerializer.SerializeToElement(boolean);
        }
        else
        {
            value = JsonSerializer.SerializeToElement(setting.Value);
            if (Sumups.Numeric(column.Type) || column.Type is "bit" or "year")
            {
                using var cmd = new MySqlCommand();
                FilterOperand(cmd, "@default", column, setting.Value);
            }
            else if (
                !TextFilterColumn(column)
                && column.Type is not "date" and not "datetime" and not "timestamp"
            )
                throw new ApiError(
                    400,
                    "Creation defaults support text, numeric, date and date/time columns."
                );
        }
        Value(value, column);
        var values = new Dictionary<string, JsonElement> { [field.Name] = value };
        LayoutRules.ValidateDropdownValues([field], values);
        LayoutRules.ValidateEmailValues([field], values);
        LayoutRules.ValidateMaskValues([field], values);
        LayoutRules.ValidateRequiredValues([field], values, null);
        return value;
    }

    public static void ApplyCreationDefaults(
        List<LayoutField> fields,
        List<ColumnInfo> columns,
        Dictionary<string, JsonElement> values
    )
    {
        foreach (
            var field in fields.Where(f => f.CreationDefault != null && !values.ContainsKey(f.Name))
        )
        {
            var column =
                columns.Find(c => c.Name == field.Name)
                ?? throw new ApiError(400, $"Default column {field.Name} no longer exists.");
            values[field.Name] = DefaultValue(field, column);
        }
    }

    public async Task ValidateCreationDefaults(
        MySqlConnection c,
        List<LayoutField> fields,
        List<ColumnInfo> columns
    )
    {
        var values = new Dictionary<string, JsonElement>();
        ApplyCreationDefaults(fields, columns, values);
        foreach (
            var field in fields.Where(f =>
                f.Widget == "lookup" && f.Lookup != null && values.ContainsKey(f.Name)
            )
        )
        foreach (var copied in await CopyLookupValues(c, field.Lookup!, values[field.Name]))
            values[copied.Key] = copied.Value;
        LayoutRules.ValidateMaskValues(fields, values);
    }
}
