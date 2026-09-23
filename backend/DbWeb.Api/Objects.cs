using System.Text.Json;

namespace DbWeb.Api;

// The object definition is the application-facing model: validation, controls,
// relationships and calculated behavior. Layout stores presentation only.
public record ObjectField(
    string Name,
    string Label,
    string Section,
    bool ReadOnly,
    string Widget,
    LookupConfig? Lookup = null,
    List<DropdownOption>? Options = null,
    JoinConfig? Join = null,
    bool Required = false,
    string? Formula = null,
    SumupConfig? Sumup = null,
    CreationDefault? CreationDefault = null
);

public record ObjectDefinition(
    List<ObjectField> Fields,
    ListView? View = null,
    bool SumupsPending = false
);

public record FieldPresentation(
    string Name,
    int EditorOrder = 0,
    bool ShowInEditor = true,
    bool ShowInList = true,
    int? ListOrder = null
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
        var names = stored
            .Object.Fields.Select(f => f.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var layout = stored
            .Layout.Fields.Where(f => names.Contains(f.Name))
            .GroupBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();
        for (var i = 0; i < stored.Object.Fields.Count; i++)
        {
            var field = stored.Object.Fields[i];
            if (!layout.Any(f => f.Name.Equals(field.Name, StringComparison.OrdinalIgnoreCase)))
                layout.Add(new(field.Name, EditorOrder: i, ListOrder: i));
        }
        return stored with { Layout = new(layout) };
    }

    public static StoredObjectDefinition Split(LayoutDefinition definition)
    {
        var objects = definition
            .Fields.Select(f => new ObjectField(
                f.Name,
                f.Label,
                f.Section,
                f.ReadOnly,
                f.Widget,
                f.Lookup,
                f.Options,
                f.Join,
                f.Required,
                f.Formula,
                f.Sumup,
                f.CreationDefault
            ))
            .ToList();
        var layout = definition
            .Fields.Select(
                (f, i) =>
                    new FieldPresentation(
                        f.Name,
                        f.Order,
                        !f.Hidden,
                        f.ShowInList,
                        f.ListOrder ?? f.Order
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
                    new(
                        column.Name,
                        column.Name,
                        "",
                        column.Generated || column.AutoIncrement,
                        "auto"
                    )
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
                            f.Label,
                            f.Section,
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
                            f.CreationDefault
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
