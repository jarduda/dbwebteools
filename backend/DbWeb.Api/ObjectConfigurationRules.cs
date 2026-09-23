using MySqlConnector;

namespace DbWeb.Api;

public static class ObjectConfigurationRules
{
    public static void ValidatePresentation(
        ObjectDefinition definition,
        LayoutPresentation presentation
    )
    {
        if (presentation?.Fields == null || presentation.Fields.Any(f => f == null))
            throw new ApiError(400, "Layout fields are required.");
        var names = definition
            .Fields.Select(f => f.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (
            presentation.Fields.Count != definition.Fields.Count
            || presentation
                .Fields.Select(f => f.Name)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count() != presentation.Fields.Count
            || presentation.Fields.Any(f => !names.Contains(f.Name))
        )
            throw new ApiError(400, "Layout must configure every object field exactly once.");
        if (presentation.Fields.Any(f => f.Section == null || f.Section.Length > 150))
            throw new ApiError(400, "Editor section names must be at most 150 characters.");
        var required = definition.Fields.Where(f => f.Required).Select(f => f.Name).ToHashSet();
        if (presentation.Fields.Any(f => !f.ShowInEditor && required.Contains(f.Name)))
            throw new ApiError(400, "Required fields must remain visible in the editor.");
    }

    public static async Task<LayoutDefinition> Validate(
        DatabaseService service,
        MySqlConnection connection,
        string table,
        ObjectDefinition definition,
        LayoutPresentation presentation
    )
    {
        if (definition.Fields == null || definition.Fields.Any(f => f == null))
            throw new ApiError(400, "Object fields are required.");
        if (definition.Fields.Any(f => f.Label == null || f.Label.Length > 150))
            throw new ApiError(400, "Field labels must be at most 150 characters.");
        if (
            definition.Fields.Select(x => x.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count()
                != definition.Fields.Count
            || definition.Fields.Count(x => x.Widget is "join" or "formula") > 20
        )
            throw new ApiError(400, "Invalid object fields.");

        ValidatePresentation(definition, presentation);
        var fields = ObjectModel.Merge(definition, presentation).Fields;
        var columns = await service.Columns(connection, table);
        using var validation = connection.CreateCommand();
        DatabaseService.ViewPredicate(validation, definition.View, columns);
        if (
            fields.Any(x =>
                (x.Widget is not "join" and not "formula" && !columns.Any(y => y.Name == x.Name))
                || !new[]
                {
                    "auto",
                    "text",
                    "textarea",
                    "number",
                    "date",
                    "datetime",
                    "dropdown",
                    "checkbox",
                    "lookup",
                    "join",
                    "formula",
                    "sumup",
                }.Contains(x.Widget)
            )
        )
            throw new ApiError(400, "Invalid object fields.");

        foreach (var field in fields)
        {
            if (field.Widget != "sumup" && field.Sumup != null)
                throw new ApiError(400, "Only sum-up fields can define sum-up configuration.");
            if (field.Widget is "join" or "formula")
            {
                if (
                    string.IsNullOrWhiteSpace(field.Name)
                    || field.Name.Length > 100
                    || field.Name != field.Name.Trim()
                    || columns.Any(col =>
                        col.Name.Equals(field.Name, StringComparison.OrdinalIgnoreCase)
                    )
                    || field.Required
                    || field.CreationDefault != null
                    || !field.ReadOnly
                    || field.Lookup != null
                    || field.Options is { Count: > 0 }
                )
                    throw new ApiError(
                        400,
                        "Computed fields must have a unique virtual name, be read-only, and have no editable control configuration."
                    );
                if (field.Widget == "formula")
                {
                    if (field.Join != null)
                        throw new ApiError(400, "Formula fields cannot define a join.");
                    Formulas.Compile(field.Formula, columns, fields);
                }
                else
                {
                    if (field.Formula != null)
                        throw new ApiError(400, "Only formula fields may define a formula.");
                    await service.ValidateJoin(
                        connection,
                        field.Join ?? throw new ApiError(400, "Join configuration required."),
                        columns
                    );
                }
                continue;
            }
            if (field.Formula != null)
                throw new ApiError(400, "Only formula fields may define a formula.");
            if (field.Join != null)
                throw new ApiError(400, "Only joined fields may define a join.");
            LayoutRules.Validate(field, columns.Single(x => x.Name == field.Name));
            if (field.Widget == "lookup")
                await service.ValidateLookup(
                    connection,
                    field.Lookup ?? throw new ApiError(400, "Lookup configuration required."),
                    columns.Single(x => x.Name == field.Name)
                );
            else if (field.Lookup != null)
                throw new ApiError(400, "Only lookup controls may have lookup configuration.");
        }
        await service.ValidateCopyMappings(connection, fields, columns);
        await service.ValidateCreationDefaults(connection, fields, columns);
        return new(fields, definition.View, definition.SumupsPending);
    }
}
