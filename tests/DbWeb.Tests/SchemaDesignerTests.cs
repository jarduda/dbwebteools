using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DbWeb.Api;
using MySqlConnector;
using Xunit;

namespace DbWeb.Tests;

public partial class ApiTests
{
    [Fact]
    public async Task SchemaDesignerCreatesTypedTablesRelationsAndPreservesDataAndPermissions()
    {
        var cs = Environment.GetEnvironmentVariable("MARIADB_TEST_CONNECTION");
        if (string.IsNullOrEmpty(cs))
        {
            Assert.False(Environment.GetEnvironmentVariable("CI") == "true");
            return;
        }
        await using var c = new MySqlConnection(cs);
        await c.OpenAsync();
        var suffix = Guid.NewGuid().ToString("N");
        var parent = "sd_p_" + suffix;
        var child = "sd_c_" + suffix;
        using var cmd = c.CreateCommand();
        try
        {
            using var factory = new Factory();
            using var admin = factory.CreateClient();
            await Login(admin);
            var b = new MySqlConnectionStringBuilder(cs);
            var created = await admin.PostAsJsonAsync(
                "/api/admin/connections",
                new ConnectionInput(
                    "Schema",
                    b.Server,
                    b.Port,
                    b.Database,
                    b.UserID,
                    b.Password,
                    false
                )
            );
            created.EnsureSuccessStatusCode();
            var id = (await created.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("id")
                .GetInt32();
            var root = $"/api/admin/connections/{id}/schema/tables";
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (await admin.PostAsJsonAsync(root, new NewTable("bad; DROP TABLE x"))).StatusCode
            );
            (await admin.PostAsJsonAsync(root, new NewTable(parent))).EnsureSuccessStatusCode();
            (
                await admin.PostAsJsonAsync(root, new NewTable(child, "record_id"))
            ).EnsureSuccessStatusCode();
            Assert.Equal(
                HttpStatusCode.Conflict,
                (await admin.PostAsJsonAsync(root, new NewTable(parent))).StatusCode
            );
            async Task<TableSchema> Schema(string table) =>
                (await admin.GetFromJsonAsync<TableSchema>(root + "/" + table))!;
            async Task<HttpResponseMessage> Column(
                string table,
                SchemaColumnInput input,
                bool modify = false
            ) =>
                await admin.PostAsJsonAsync(
                    root + "/" + table + (modify ? "/modify-column" : "/columns"),
                    input with
                    {
                        Version = (await Schema(table)).Version,
                    }
                );
            var first = await Schema(child);
            var pk = Assert.Single(first.Columns);
            Assert.Equal("record_id", pk.Name);
            Assert.True(pk.PrimaryKey);
            Assert.True(pk.AutoIncrement);
            (
                await Column(parent, new("name", "text", false, Length: 40))
            ).EnsureSuccessStatusCode();
            (await Column(child, new("title", "text", Length: 40))).EnsureSuccessStatusCode();
            (
                await Column(child, new("amount", "decimal", Precision: 12, Scale: 4))
            ).EnsureSuccessStatusCode();
            (await Column(child, new("active", "boolean"))).EnsureSuccessStatusCode();
            (await Column(child, new("happened", "datetime"))).EnsureSuccessStatusCode();
            (await Column(child, new("notes", "longtext"))).EnsureSuccessStatusCode();
            (await Column(child, new("day", "date"))).EnsureSuccessStatusCode();
            (await Column(child, new("quantity", "integer"))).EnsureSuccessStatusCode();
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (await Column(child, new("bad", "decimal", Precision: 3, Scale: 4))).StatusCode
            );
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (await Column(child, new("bad", "text", Length: 0))).StatusCode
            );
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (
                    await Column(
                        child,
                        new(
                            "badrel",
                            "relation",
                            RelatedTable: parent,
                            RelatedKey: "name",
                            DisplayColumn: "name"
                        )
                    )
                ).StatusCode
            );
            // Preserve list settings when a relation adds a lookup field.
            (
                await admin.PutAsJsonAsync(
                    $"/api/admin/connections/{id}/tables/{child}/layout",
                    new LayoutDefinition([], new ListView(Label: "Keep label"))
                )
            ).EnsureSuccessStatusCode();
            (
                await Column(
                    child,
                    new(
                        "parent_id",
                        "relation",
                        RelatedTable: parent,
                        RelatedKey: "id",
                        DisplayColumn: "name"
                    )
                )
            ).EnsureSuccessStatusCode();
            var relation = (await Schema(child)).Columns.Single(x => x.Name == "parent_id");
            Assert.Equal(parent, relation.RelatedTable);
            Assert.Equal("id", relation.RelatedKey);
            Assert.Equal("bigint", relation.Type);
            var settings = await admin.GetFromJsonAsync<JsonElement>(
                $"/api/connections/{id}/tables/{child}/settings"
            );
            Assert.Contains("Keep label", settings.ToString());
            Assert.Contains("lookup", settings.ToString());
            var beforeInsertVersion = (await Schema(child)).Version;
            cmd.CommandText =
                $"INSERT INTO `{parent}` (name) VALUES ('Friendly');INSERT INTO `{child}` (title,amount,parent_id) VALUES ('Long title',12.3456,1)";
            await cmd.ExecuteNonQueryAsync();
            Assert.Equal(beforeInsertVersion, (await Schema(child)).Version);
            cmd.CommandText = $"INSERT INTO `{child}` (parent_id) VALUES(999)";
            await Assert.ThrowsAsync<MySqlException>(() => cmd.ExecuteNonQueryAsync());
            // Invalid keys are also rejected by the regular record API.
            var add = await admin.PostAsJsonAsync(
                $"/api/connections/{id}/tables/{child}/create",
                new { values = new { parent_id = 999 } }
            );
            Assert.Equal(HttpStatusCode.BadRequest, add.StatusCode);
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (await Column(child, new("required_later", "text", false))).StatusCode
            );
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (await Column(child, new("title", "text", Length: 3), true)).StatusCode
            );
            (await Column(child, new("title", "text", Length: 80), true)).EnsureSuccessStatusCode();
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (
                    await Column(child, new("amount", "decimal", Precision: 12, Scale: 2), true)
                ).StatusCode
            );
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (
                    await Column(child, new("amount", "decimal", Precision: 12, Scale: 6), true)
                ).StatusCode
            );
            (
                await Column(child, new("amount", "decimal", Precision: 16, Scale: 6), true)
            ).EnsureSuccessStatusCode();
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (await Column(child, new("notes", "longtext", false), true)).StatusCode
            );
            (
                await Column(child, new("title", "text", false, Length: 80), true)
            ).EnsureSuccessStatusCode();
            Assert.Equal(
                HttpStatusCode.BadRequest,
                (await Column(child, new("record_id", "integer"), true)).StatusCode
            );
            Assert.Equal(
                HttpStatusCode.Conflict,
                (
                    await admin.PostAsJsonAsync(
                        root + "/" + child + "/columns",
                        new SchemaColumnInput("stale", "text", Version: first.Version)
                    )
                ).StatusCode
            );
            // Existing attributes must survive MODIFY, including default quotes/comments.
            cmd.CommandText =
                $"ALTER TABLE `{child}` MODIFY title VARCHAR(80) NOT NULL DEFAULT 'O''Brien' COMMENT 'Keep comment'";
            await cmd.ExecuteNonQueryAsync();
            (
                await Column(child, new("title", "text", Length: 100), true)
            ).EnsureSuccessStatusCode();
            var title = (await Schema(child)).Columns.Single(x => x.Name == "title");
            Assert.Contains("Brien", title.Default);
            Assert.Equal("Keep comment", title.Comment);
            cmd.CommandText = $"SELECT amount FROM `{child}` WHERE record_id=1";
            Assert.Equal(12.3456m, Convert.ToDecimal(await cmd.ExecuteScalarAsync()));
            cmd.CommandText = $"SELECT title FROM `{child}` WHERE record_id=1";
            Assert.Equal("Long title", await cmd.ExecuteScalarAsync());
            using var anon = factory.CreateClient();
            Assert.Equal(
                HttpStatusCode.Unauthorized,
                (await anon.GetAsync(root + "/" + child)).StatusCode
            );
            (
                await admin.PostAsJsonAsync(
                    "/api/admin/users",
                    new UserInput("schema_member", "member-password-12345", false, true)
                )
            ).EnsureSuccessStatusCode();
            using var member = factory.CreateClient();
            await Login(member, "schema_member", "member-password-12345");
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await member.GetAsync(root + "/" + child)).StatusCode
            );
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await member.PostAsJsonAsync(root, new NewTable("forbidden"))).StatusCode
            );
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (
                    await member.PostAsJsonAsync(
                        root + "/" + child + "/columns",
                        new SchemaColumnInput("forbidden", "text")
                    )
                ).StatusCode
            );
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (
                    await member.PostAsJsonAsync(
                        root + "/" + child + "/modify-column",
                        new SchemaColumnInput("title", "text")
                    )
                ).StatusCode
            );
        }
        finally
        {
            cmd.CommandText = $"DROP TABLE IF EXISTS `{child}`;DROP TABLE IF EXISTS `{parent}`";
            await cmd.ExecuteNonQueryAsync();
        }
    }
}
