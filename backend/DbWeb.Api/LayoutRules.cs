using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace DbWeb.Api;

public static class LayoutRules
{
    public static void Validate(LayoutField field, ColumnInfo column)
    {
        if (
            field.Required
            && (
                field.Hidden
                || field.ReadOnly
                || column.Generated
                || column.AutoIncrement
                || field.Widget == "join"
            )
        )
            throw new ApiError(400, "Required fields must be visible, editable stored columns.");
        if (field.Widget == "datetime" && column.Type is not "datetime" and not "timestamp")
            throw new ApiError(400, "DateTime controls require a DATETIME or TIMESTAMP column.");
        if (
            field.Widget == "date"
            && column.Type is not "date" and not "datetime" and not "timestamp"
        )
            throw new ApiError(400, "Date controls require a DATE, DATETIME, or TIMESTAMP column.");
        if (field.Widget == "email" && (column.Type != "varchar" || column.Length != 255))
            throw new ApiError(400, "Email controls require a VARCHAR(255) column.");
        if (field.Widget != "dropdown")
        {
            if (field.Options is { Count: > 0 })
                throw new ApiError(400, "Only dropdown controls may define options.");
            return;
        }
        if (
            column.Type
            is not "char"
                and not "varchar"
                and not "tinytext"
                and not "text"
                and not "mediumtext"
                and not "longtext"
        )
            throw new ApiError(400, "Dropdown controls require a text column.");
        if (
            field.Options is not { Count: > 0 and <= 200 }
            || field.Options.Any(o =>
                o == null
                || string.IsNullOrWhiteSpace(o.Key)
                || string.IsNullOrWhiteSpace(o.Display)
                || o.Key.Length > 256
                || o.Display.Length > 256
                || o.Key != o.Key.Trim()
                || o.Display != o.Display.Trim()
            )
        )
            throw new ApiError(
                400,
                "Define 1–200 dropdown options with non-blank keys and labels (up to 256 characters, no surrounding spaces)."
            );
        if (
            field.Options.Select(o => o.Key).Distinct(StringComparer.OrdinalIgnoreCase).Count()
                != field.Options.Count
            || field
                .Options.Select(o => o.Display)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count() != field.Options.Count
        )
            throw new ApiError(
                400,
                "Dropdown keys and display labels must each be unique (ignoring case)."
            );
    }

    public static void ValidateRequiredValues(
        IEnumerable<LayoutField> fields,
        Dictionary<string, JsonElement> values,
        Dictionary<string, object?>? existing
    )
    {
        foreach (var field in fields.Where(f => f.Required))
        {
            var empty = values.TryGetValue(field.Name, out var value)
                ? value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
                    || (
                        value.ValueKind == JsonValueKind.String
                        && string.IsNullOrWhiteSpace(value.GetString())
                    )
                : existing == null
                    || !existing.TryGetValue(field.Name, out var stored)
                    || stored == null
                    || stored is DBNull
                    || (stored is string text && string.IsNullOrWhiteSpace(text));
            if (empty)
                throw new ApiError(
                    400,
                    $"{(string.IsNullOrWhiteSpace(field.Label) ? field.Name : field.Label)} is required."
                );
        }
    }

    public static void ValidateDropdownValues(
        List<LayoutField> fields,
        Dictionary<string, JsonElement> values
    )
    {
        foreach (var field in fields.Where(f => f.Widget == "dropdown"))
            if (
                values.TryGetValue(field.Name, out var value)
                && value.ValueKind != JsonValueKind.Null
                && (
                    value.ValueKind != JsonValueKind.String
                    || field.Options?.Any(o => o.Key == value.GetString()) != true
                )
            )
                throw new ApiError(400, $"Choose a configured dropdown value for {field.Name}.");
    }

    public static void ValidateEmailValues(
        IEnumerable<LayoutField> fields,
        Dictionary<string, JsonElement> values
    )
    {
        var validator = new EmailAddressAttribute();
        foreach (var field in fields.Where(f => f.Widget == "email"))
        {
            if (
                !values.TryGetValue(field.Name, out var value)
                || value.ValueKind == JsonValueKind.Null
            )
                continue;
            if (value.ValueKind != JsonValueKind.String)
                throw new ApiError(400, $"Enter a valid email address for {field.Label}.");
            var text = value.GetString() ?? "";
            if (text.Length == 0)
                continue;
            if (text.Length > 255 || text != text.Trim() || !validator.IsValid(text))
                throw new ApiError(400, $"Enter a valid email address for {field.Label}.");
        }
    }

    public static void AddDropdownLabels(List<LayoutField> fields, List<RecordRow> rows)
    {
        foreach (var field in fields.Where(f => f.Widget == "dropdown" && f.Options != null))
        {
            var labels = field.Options!.ToDictionary(
                o => o.Key,
                o => o.Display,
                StringComparer.Ordinal
            );
            foreach (var row in rows)
                if (
                    row.Values.GetValueOrDefault(field.Name) is string key
                    && labels.TryGetValue(key, out var display)
                )
                    row.DisplayValues[field.Name] = display;
        }
    }
}
