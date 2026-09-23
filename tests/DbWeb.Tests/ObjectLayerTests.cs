using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DbWeb.Api;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MySqlConnector;
using Xunit;

namespace DbWeb.Tests;

public partial class ApiTests
{
    [Fact]
    public void FormerSplitMetadataMovesSectionFromObjectToLayout()
    {
        const string json = """
            {
              "Object": {
                "Fields": [
                  {
                    "Name": "title", "Label": "Title", "Section": "Details",
                    "ReadOnly": false, "Widget": "text"
                  }
                ]
              },
              "Layout": {
                "Fields": [
                  {
                    "Name": "title", "EditorOrder": 2, "ShowInEditor": true,
                    "ShowInList": true, "ListOrder": 4
                  }
                ]
              }
            }
            """;

        var stored = ObjectModel.Stored(json);
        Assert.Equal("Details", Assert.Single(stored.Layout.Fields).Section);
        var normalized = ObjectModel.Serialize(stored);
        using var document = JsonDocument.Parse(normalized);
        Assert.False(
            document
                .RootElement.GetProperty("Object")
                .GetProperty("Fields")[0]
                .TryGetProperty("Section", out _)
        );
        Assert.Equal(
            "Details",
            document
                .RootElement.GetProperty("Layout")
                .GetProperty("Fields")[0]
                .GetProperty("Section")
                .GetString()
        );
    }

    [Fact]
    public void LegacyCombinedMetadataMigratesInPlaceAndRemainsEquivalent()
    {
        var options = new DbContextOptionsBuilder<AppDb>()
            .UseSqlite("Data Source=:memory:")
            .Options;
        using var db = new AppDb(options);
        db.Database.OpenConnection();
        db.Database.EnsureCreated();
        var legacy = new LayoutDefinition(
            [
                new(
                    "title",
                    "Friendly title",
                    "Details",
                    7,
                    true,
                    false,
                    "dropdown",
                    Options: [new("a", "Active")],
                    ShowInList: false,
                    ListOrder: 3,
                    Required: false,
                    CreationDefault: new("a")
                ),
            ],
            new(Label: "Filtered", Sort: "title", Filters: [new("title", "eq", "a")])
        );
        db.Layouts.Add(
            new()
            {
                ConnectionId = 1,
                Table = "records",
                FieldsJson = JsonSerializer.Serialize(legacy),
            }
        );
        db.SaveChanges();

        ObjectModel.Migrate(db);
        var stored = db.Layouts.Single().FieldsJson;
        using var document = JsonDocument.Parse(stored);
        Assert.True(document.RootElement.TryGetProperty("Object", out _));
        Assert.True(document.RootElement.TryGetProperty("Layout", out _));
        Assert.False(
            document
                .RootElement.GetProperty("Object")
                .GetProperty("Fields")[0]
                .TryGetProperty("Section", out _)
        );
        Assert.Equal(
            "Details",
            document
                .RootElement.GetProperty("Layout")
                .GetProperty("Fields")[0]
                .GetProperty("Section")
                .GetString()
        );
        var merged = DatabaseService.Layout(stored);
        var field = Assert.Single(merged.Fields);
        Assert.Equal("Friendly title", field.Label);
        Assert.Equal("Details", field.Section);
        Assert.Equal(7, field.Order);
        Assert.True(field.Hidden);
        Assert.False(field.ShowInList);
        Assert.Equal(3, field.ListOrder);
        Assert.Equal("dropdown", field.Widget);
        Assert.Equal("Filtered", merged.View!.Label);

        ObjectModel.Migrate(db);
        Assert.Equal(stored, db.Layouts.Single().FieldsJson);
    }

    [Fact]
    public async Task ObjectAndPresentationLayersMigrateAndSaveIndependently()
    {
        var cs = Environment.GetEnvironmentVariable("MARIADB_TEST_CONNECTION");
        if (string.IsNullOrEmpty(cs))
        {
            Assert.False(Environment.GetEnvironmentVariable("CI") == "true");
            return;
        }
        await using var connection = new MySqlConnection(cs);
        await connection.OpenAsync();
        var table = "object_layer_" + Guid.NewGuid().ToString("N");
        await using var command = connection.CreateCommand();
        command.CommandText =
            $"CREATE TABLE `{table}`(id INT AUTO_INCREMENT PRIMARY KEY,title VARCHAR(80),status VARCHAR(20),amount DECIMAL(12,2));INSERT INTO `{table}`(title,status,amount) VALUES('Original','a',12.50)";
        await command.ExecuteNonQueryAsync();
        try
        {
            using var factory = new Factory();
            using var admin = factory.CreateClient();
            await Login(admin);
            var builder = new MySqlConnectionStringBuilder(cs);
            var response = await admin.PostAsJsonAsync(
                "/api/admin/connections",
                new ConnectionInput(
                    "Objects",
                    builder.Server,
                    builder.Port,
                    builder.Database,
                    builder.UserID,
                    builder.Password,
                    false
                )
            );
            response.EnsureSuccessStatusCode();
            var connectionId = (await response.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("id")
                .GetInt32();
            var root = $"/api/admin/connections/{connectionId}/tables/{table}";
            var legacy = new LayoutDefinition(
                [
                    new("id", "ID", "Keys", 3, true, true, "auto", ShowInList: false),
                    new(
                        "title",
                        "Title label",
                        "Content",
                        2,
                        false,
                        false,
                        "text",
                        ShowInList: true,
                        ListOrder: 4,
                        Required: true,
                        CreationDefault: new("New title")
                    ),
                    new(
                        "status",
                        "State",
                        "Content",
                        1,
                        false,
                        false,
                        "dropdown",
                        Options: [new("a", "Active"), new("b", "Blocked")],
                        ShowInList: true,
                        ListOrder: 1
                    ),
                    new(
                        "computed",
                        "Computed",
                        "Metrics",
                        5,
                        false,
                        true,
                        "formula",
                        ShowInList: true,
                        ListOrder: 2,
                        Formula: "Round([amount] * 2, 2)"
                    ),
                ],
                new(Label: "Object list", Sort: "title", Filters: [new("status", "eq", "a")])
            );
            // Former combined clients continue to work, but persistence is normalized.
            (await admin.PutAsJsonAsync(root + "/layout", legacy)).EnsureSuccessStatusCode();

            var objectDefinition = (
                await admin.GetFromJsonAsync<ObjectDefinition>(root + "/object")
            )!;
            Assert.Equal(
                "Title label",
                objectDefinition.Fields.Single(f => f.Name == "title").Label
            );
            Assert.True(objectDefinition.Fields.Single(f => f.Name == "title").Required);
            Assert.Equal("Object list", objectDefinition.View!.Label);
            var presentation = (
                await admin.GetFromJsonAsync<LayoutPresentation>(root + "/layout")
            )!;
            var titleLayout = presentation.Fields.Single(f => f.Name == "title");
            Assert.Equal("Content", titleLayout.Section);
            Assert.Equal(2, titleLayout.EditorOrder);
            Assert.True(titleLayout.ShowInEditor);
            Assert.True(titleLayout.ShowInList);
            Assert.Equal(4, titleLayout.ListOrder);

            var objectJson = await admin.GetStringAsync(root + "/object");
            Assert.DoesNotContain("editorOrder", objectJson, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("showInList", objectJson, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("section", objectJson, StringComparison.OrdinalIgnoreCase);
            var layoutJson = await admin.GetStringAsync(root + "/layout");
            Assert.DoesNotContain("widget", layoutJson, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("label", layoutJson, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("section", layoutJson, StringComparison.OrdinalIgnoreCase);

            objectDefinition = objectDefinition with
            {
                Fields = objectDefinition
                    .Fields.Select(f =>
                        f.Name == "title"
                            ? f with
                            {
                                Label = "Object title",
                                Widget = "textarea",
                            }
                            : f
                    )
                    .ToList(),
            };
            (
                await admin.PutAsJsonAsync(root + "/object", objectDefinition)
            ).EnsureSuccessStatusCode();
            var settings = await admin.GetFromJsonAsync<JsonElement>(
                $"/api/connections/{connectionId}/tables/{table}/settings"
            );
            var title = settings
                .GetProperty("fields")
                .EnumerateArray()
                .Single(f => f.GetProperty("name").GetString() == "title");
            Assert.Equal("Object title", title.GetProperty("label").GetString());
            Assert.Equal("textarea", title.GetProperty("widget").GetString());
            Assert.Equal("Content", title.GetProperty("section").GetString());
            Assert.Equal(2, title.GetProperty("order").GetInt32());
            Assert.Equal(4, title.GetProperty("listOrder").GetInt32());

            presentation = (await admin.GetFromJsonAsync<LayoutPresentation>(root + "/layout"))!;
            presentation = presentation with
            {
                Fields = presentation
                    .Fields.Select(f =>
                        f.Name == "title"
                            ? f with
                            {
                                Section = "Summary",
                                EditorOrder = 8,
                                ShowInEditor = true,
                                ShowInList = false,
                                ListOrder = 9,
                            }
                            : f
                    )
                    .ToList(),
            };
            (await admin.PutAsJsonAsync(root + "/layout", presentation)).EnsureSuccessStatusCode();
            var unchangedObject = (
                await admin.GetFromJsonAsync<ObjectDefinition>(root + "/object")
            )!;
            Assert.Equal("textarea", unchangedObject.Fields.Single(f => f.Name == "title").Widget);
            settings = await admin.GetFromJsonAsync<JsonElement>(
                $"/api/connections/{connectionId}/tables/{table}/settings"
            );
            title = settings
                .GetProperty("fields")
                .EnumerateArray()
                .Single(f => f.GetProperty("name").GetString() == "title");
            Assert.Equal(8, title.GetProperty("order").GetInt32());
            Assert.Equal("Summary", title.GetProperty("section").GetString());
            Assert.False(title.GetProperty("showInList").GetBoolean());
            Assert.Equal(9, title.GetProperty("listOrder").GetInt32());

            // Presentation-only clients from the previous release omitted section.
            // Their saves must retain the section instead of silently clearing it.
            (
                await admin.PutAsJsonAsync(
                    root + "/layout",
                    new
                    {
                        fields = presentation.Fields.Select(f => new
                        {
                            name = f.Name,
                            editorOrder = f.EditorOrder,
                            showInEditor = f.ShowInEditor,
                            showInList = f.ShowInList,
                            listOrder = f.ListOrder,
                        }),
                    }
                )
            ).EnsureSuccessStatusCode();
            settings = await admin.GetFromJsonAsync<JsonElement>(
                $"/api/connections/{connectionId}/tables/{table}/settings"
            );
            title = settings
                .GetProperty("fields")
                .EnumerateArray()
                .Single(f => f.GetProperty("name").GetString() == "title");
            Assert.Equal("Summary", title.GetProperty("section").GetString());

            Assert.Equal(
                HttpStatusCode.BadRequest,
                (
                    await admin.PutAsJsonAsync(
                        root + "/layout",
                        presentation with
                        {
                            Fields = presentation.Fields.Skip(1).ToList(),
                        }
                    )
                ).StatusCode
            );
            var hiddenRequired = presentation with
            {
                Fields = presentation
                    .Fields.Select(f => f.Name == "title" ? f with { ShowInEditor = false } : f)
                    .ToList(),
            };
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (await admin.PutAsJsonAsync(root + "/layout", hiddenRequired)).StatusCode
            );

            var records = await admin.GetFromJsonAsync<JsonElement>(
                $"/api/connections/{connectionId}/tables/{table}/records"
            );
            Assert.Equal(
                "Active",
                records
                    .GetProperty("rows")[0]
                    .GetProperty("displayValues")
                    .GetProperty("status")
                    .GetString()
            );
            Assert.Equal(
                "25.00",
                records
                    .GetProperty("rows")[0]
                    .GetProperty("joinedValues")
                    .GetProperty("computed")
                    .GetString()
            );

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            var stored = await db.Layouts.SingleAsync(l =>
                l.ConnectionId == connectionId && l.Table == table
            );
            using var document = JsonDocument.Parse(stored.FieldsJson);
            Assert.True(document.RootElement.TryGetProperty("Object", out _));
            Assert.True(document.RootElement.TryGetProperty("Layout", out _));
            Assert.DoesNotContain(
                "\"Widget\"",
                document.RootElement.GetProperty("Layout").ToString()
            );
        }
        finally
        {
            command.CommandText = $"DROP TABLE `{table}`";
            await command.ExecuteNonQueryAsync();
        }
    }
}
