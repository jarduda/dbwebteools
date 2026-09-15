using System.Text.Json;
using DbWeb.Api;
using Microsoft.AspNetCore.DataProtection;
using MySqlConnector;
using Xunit;

namespace DbWeb.Tests;

public class MariaDbTests
{
    [Fact]
    public async Task CrudSupportsCompositeKeysAndRejectsStaleWrites()
    {
        var cs = Environment.GetEnvironmentVariable("MARIADB_TEST_CONNECTION");
        if (string.IsNullOrEmpty(cs))
        {
            Assert.False(
                Environment.GetEnvironmentVariable("CI") == "true",
                "CI must provide a MariaDB service."
            );
            return;
        }
        await using var conn = new MySqlConnection(cs);
        await conn.OpenAsync();
        var table = "test_" + Guid.NewGuid().ToString("N");
        await using var cmd = conn.CreateCommand();
        cmd.CommandText =
            $"CREATE TABLE `{table}` (tenant INT NOT NULL DEFAULT 1,id INT NOT NULL DEFAULT 2,name VARCHAR(100) NOT NULL DEFAULT 'Default',amount DECIMAL(20,4), PRIMARY KEY(tenant,id)) ENGINE=InnoDB";
        await cmd.ExecuteNonQueryAsync();
        try
        {
            var service = new DatabaseService(new EphemeralDataProtectionProvider());
            Dictionary<string, JsonElement> D(string json) =>
                JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;
            await service.Mutate(
                conn,
                table,
                new(
                    D(
                        "{\"tenant\":1,\"id\":2,\"name\":\"O'Reilly\",\"amount\":\"9007199254740993.1234\"}"
                    ),
                    null,
                    null
                ),
                "create"
            );
            var page = JsonSerializer.SerializeToElement(
                await service.List(conn, table, 1, 25, null, false, "O'Reilly"),
                new JsonSerializerOptions(JsonSerializerDefaults.Web)
            );
            Assert.Equal(1, page.GetProperty("total").GetInt32());
            var row = page.GetProperty("rows")[0];
            Assert.Equal(
                "9007199254740993.1234",
                row.GetProperty("values").GetProperty("amount").GetString()
            );
            var key = D("{\"tenant\":1,\"id\":2}");
            var version = row.GetProperty("version").GetString();
            await service.Mutate(
                conn,
                table,
                new(D("{\"name\":\"Updated\"}"), key, version),
                "update"
            );
            var stale = await Assert.ThrowsAsync<ApiError>(() =>
                service.Mutate(conn, table, new(D("{}"), key, version), "delete")
            );
            Assert.Equal(409, stale.Status);
            page = JsonSerializer.SerializeToElement(
                await service.List(conn, table, 1, 25, null, false, null),
                new JsonSerializerOptions(JsonSerializerDefaults.Web)
            );
            await service.Mutate(
                conn,
                table,
                new(D("{}"), key, page.GetProperty("rows")[0].GetProperty("version").GetString()),
                "delete"
            );
            page = JsonSerializer.SerializeToElement(
                await service.List(conn, table, 1, 25, null, false, null),
                new JsonSerializerOptions(JsonSerializerDefaults.Web)
            );
            Assert.Equal(0, page.GetProperty("total").GetInt32());
            await service.Mutate(conn, table, new(D("{}"), null, null), "create");
            page = JsonSerializer.SerializeToElement(
                await service.List(conn, table, 1, 25, null, false, null),
                new JsonSerializerOptions(JsonSerializerDefaults.Web)
            );
            Assert.Equal(
                "Default",
                page.GetProperty("rows")[0].GetProperty("values").GetProperty("name").GetString()
            );
        }
        finally
        {
            cmd.CommandText = $"DROP TABLE `{table}`";
            await cmd.ExecuteNonQueryAsync();
        }
    }
}
