using System.Text.Json;

namespace DbWeb.Api;

// The object definition is the application-facing model: validation, controls,
// relationships and calculated behavior. Layout stores presentation only.
public record ObjectField(
    string Name,
    string Label,
    bool ReadOnly,
    string Widget,
    LookupConfig? Lookup = null,
    List<DropdownOption>? Options = null,
    JoinConfig? Join = null,
    bool Required = false,
    string? Formula = null,
    SumupConfig? Sumup = null,
    CreationDefault? CreationDefault = null,
    InputMask? Mask = null
);

public record InputMask(
    string CharacterSet,
    int MinimumLength = 1,
    string RequiredCharacters = ""
);

public record ObjectDefinition(
    List<ObjectField> Fields,
    ListView? View = null,
    bool SumupsPending = false
);

public record FieldPresentation(
    string Name,
    string Section = "",
    int EditorOrder = 0,
    bool ShowInEditor = true,
    bool ShowInList = true,
    int? ListOrder = null,
    string? Label = null
);

public record LayoutPresentation(List<FieldPresentation> Fields);

public record StoredObjectDefinition(ObjectDefinition Object, LayoutPresentation Layout);

public static class ObjectModel
{
    static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    static bool TryProperty(JsonElement element, string name, out JsonElement value)
    {
        foreach (var property in element.EnumerateObject())
            if (property.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
            {
                value = property.Value;
                return true;
            }
        value = default;
        return false;
    }

    public static StoredObjectDefinition Stored(string? json)
    {
        using var document = JsonDocument.Parse(json ?? "[]");
        try
        {
            if (
                document.RootElement.ValueKind == JsonValueKind.Object
                && TryProperty(document.RootElement, "object", out _)
            )
            {
                var stored = document.RootElement.Deserialize<StoredObjectDefinition>(Json);
                if (
                    stored?.Object?.Fields == null
                    || stored.Layout?.Fields == null
                    || stored.Object.Fields.Any(f => f == null)
                    || stored.Layout.Fields.Any(f => f == null)
                )
                    throw new ApiError(400, "Object and layout fields are required.");
                var legacySections = new Dictionary<string, string>(
                    StringComparer.OrdinalIgnoreCase
                );
                if (
                    TryProperty(document.RootElement, "object", out var objectElement)
                    && TryProperty(objectElement, "fields", out var objectFields)
                )
                    foreach (var field in objectFields.EnumerateArray())
                        if (
                            TryProperty(field, "name", out var name)
                            && TryProperty(field, "section", out var section)
                            && name.ValueKind == JsonValueKind.String
                            && section.ValueKind is JsonValueKind.String or JsonValueKind.Null
                        )
                            legacySections[name.GetString() ?? ""] = section.GetString() ?? "";
                var layoutHasSection = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (
                    TryProperty(document.RootElement, "layout", out var layoutElement)
                    && TryProperty(layoutElement, "fields", out var layoutFields)
                )
                    foreach (var field in layoutFields.EnumerateArray())
                        if (
                            TryProperty(field, "name", out var name)
                            && TryProperty(field, "section", out _)
                            && name.ValueKind == JsonValueKind.String
                        )
                            layoutHasSection.Add(name.GetString() ?? "");
                stored = stored with
                {
                    Layout = new(
                        stored
                            .Layout.Fields.Select(f =>
                                !layoutHasSection.Contains(f.Name)
                                && legacySections.TryGetValue(f.Name, out var section)
                                    ? f with
                                    {
                                        Section = section,
                                    }
                                    : f
                            )
                            .ToList()
                    ),
                };
                return Normalize(stored);
            }
            return Split(DatabaseService.ParseLegacyLayout(document.RootElement));
        }
        catch (JsonException)
        {
            throw new ApiError(400, "Invalid object configuration.");
        }
    }

    static StoredObjectDefinition Normalize(StoredObjectDefinition stored)
    {
        var legacyLabels = stored.Object.Fields.ToDictionary(
            f => f.Name,
            f => f.Label,
            StringComparer.OrdinalIgnoreCase
        );
        var names = stored
            .Object.Fields.Select(f => f.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var layout = stored
            .Layout.Fields.Where(f => names.Contains(f.Name))
            .GroupBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
            .Select(g =>
            {
                var field = g.First();
                return field with
                {
                    Section = field.Section ?? "",
                    Label = field.Label == null
                        ? legacyLabels.GetValueOrDefault(field.Name, field.Name)
                        : field.Label,
                };
            })
            .ToList();
        for (var i = 0; i < stored.Object.Fields.Count; i++)
        {
            var field = stored.Object.Fields[i];
            if (!layout.Any(f => f.Name.Equals(field.Name, StringComparison.OrdinalIgnoreCase)))
                layout.Add(
                    new(
                        field.Name,
                        EditorOrder: i,
                        ListOrder: i,
                        Label: field.Label
                    )
                );
        }
        var labels = layout.ToDictionary(f => f.Name, f => f.Label, StringComparer.OrdinalIgnoreCase);
        var definition = stored.Object with
        {
            // Keep the legacy projection populated while presentation owns labels.
            Fields = stored.Object.Fields.Select(f =>
                    f with { Label = labels.GetValueOrDefault(f.Name) ?? f.Label ?? f.Name }
                )
                .ToList(),
        };
        return new(definition, new(layout));
    }

    public static StoredObjectDefinition Split(LayoutDefinition definition)
    {
        var objects = definition
            .Fields.Select(f => new ObjectField(
                f.Name,
                f.Label,
                f.ReadOnly,
                f.Widget,
                f.Lookup,
                f.Options,
                f.Join,
                f.Required,
                f.Formula,
                f.Sumup,
                f.CreationDefault,
                f.Mask
            ))
            .ToList();
        var layout = definition
            .Fields.Select(
                (f, i) =>
                    new FieldPresentation(
                        f.Name,
                        Section: f.Section,
                        EditorOrder: f.Order,
                        ShowInEditor: !f.Hidden,
                        ShowInList: f.ShowInList,
                        ListOrder: f.ListOrder ?? f.Order,
                        Label: f.Label
                    )
            )
            .ToList();
        return new(new(objects, definition.View, definition.SumupsPending), new(layout));
    }

    public static LayoutPresentation CompleteLayout(
        ObjectDefinition definition,
        LayoutPresentation presentation
    ) => Normalize(new(definition, presentation)).Layout;

    public static ObjectDefinition WithColumns(
        ObjectDefinition definition,
        IEnumerable<ColumnInfo> columns
    )
    {
        var fields = definition.Fields.ToList();
        foreach (var column in columns)
            if (
                !fields.Any(field =>
                    field.Name.Equals(column.Name, StringComparison.OrdinalIgnoreCase)
                )
            )
                fields.Add(
                    new(column.Name, column.Name, column.Generated || column.AutoIncrement, "auto")
                );
        return definition with { Fields = fields };
    }

    public static LayoutDefinition Merge(ObjectDefinition definition, LayoutPresentation layout)
    {
        var presentation = layout.Fields.ToDictionary(
            f => f.Name,
            StringComparer.OrdinalIgnoreCase
        );
        return new(
            definition
                .Fields.Select(
                    (f, i) =>
                    {
                        var p =
                            presentation.GetValueOrDefault(f.Name)
                            ?? new FieldPresentation(f.Name, EditorOrder: i, ListOrder: i);
                        return new LayoutField(
                            f.Name,
                            p.Label ?? f.Label,
                            p.Section,
                            p.EditorOrder,
                            !p.ShowInEditor,
                            f.ReadOnly,
                            f.Widget,
                            f.Lookup,
                            f.Options,
                            p.ShowInList,
                            p.ListOrder,
                            f.Join,
                            f.Required,
                            f.Formula,
                            f.Sumup,
                            f.CreationDefault,
                            f.Mask
                        );
                    }
                )
                .ToList(),
            definition.View,
            definition.SumupsPending
        );
    }

    public static LayoutDefinition Merge(StoredObjectDefinition stored) =>
        Merge(stored.Object, stored.Layout);

    public static string Serialize(StoredObjectDefinition stored) =>
        JsonSerializer.Serialize(Normalize(stored));

    public static string Serialize(LayoutDefinition definition) => Serialize(Split(definition));

    public static string Serialize(ObjectDefinition definition, LayoutPresentation presentation) =>
        Serialize(new StoredObjectDefinition(definition, presentation));

    public static void Migrate(AppDb db)
    {
        var changed = false;
        foreach (var configuration in db.Layouts)
        {
            var normalized = Serialize(Stored(configuration.FieldsJson));
            if (configuration.FieldsJson == normalized)
                continue;
            configuration.FieldsJson = normalized;
            changed = true;
        }
        if (changed)
            db.SaveChanges();
    }
}
