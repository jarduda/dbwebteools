using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DbWeb.Api;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Xunit;
namespace DbWeb.Tests;
public class ApiTests
{
    private class Factory : WebApplicationFactory<Program> { readonly string path = Path.Combine(Path.GetTempPath(), "dbweb-test-" + Guid.NewGuid()); protected override void ConfigureWebHost(IWebHostBuilder b) { b.UseEnvironment("Development"); b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { { "DataDirectory", path }, { "Bootstrap:Password", "test-only-password-12345" } })); } protected override void Dispose(bool d) { base.Dispose(d); if (d && Directory.Exists(path)) Directory.Delete(path, true); } }
    static async Task Csrf(HttpClient c) { var token = await c.GetFromJsonAsync<JsonElement>("/api/auth/csrf"); c.DefaultRequestHeaders.Remove("X-CSRF-TOKEN"); c.DefaultRequestHeaders.Add("X-CSRF-TOKEN", token.GetProperty("token").GetString()); }
    static async Task Login(HttpClient c, string username = "admin", string password = "test-only-password-12345") { await Csrf(c); var r = await c.PostAsJsonAsync("/api/auth/login", new { username, password }); r.EnsureSuccessStatusCode(); await Csrf(c); }
    [Fact] public async Task AnonymousCannotReadAdministration() { using var f = new Factory(); using var c = f.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/admin/users")).StatusCode); }
    [Fact] public async Task LoginRequiresCsrf() { using var f = new Factory(); using var c = f.CreateClient(); Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/auth/login", new { username = "admin", password = "test-only-password-12345" })).StatusCode); }
    [Fact] public async Task PermissionsAndRevocationAreEnforced() { using var f = new Factory(); using var admin = f.CreateClient(); await Login(admin); var r = await admin.PostAsJsonAsync("/api/admin/users", new { username = "member", password = "member-password-12345", isAdmin = false, enabled = true }); r.EnsureSuccessStatusCode(); var id = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32(); using var member = f.CreateClient(); await Login(member, "member", "member-password-12345"); Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/api/admin/users")).StatusCode); Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/api/connections/999/tables/private/records")).StatusCode); Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync("/api/connections/999/tables/private/delete", new { values = new { }, key = new { id = 1 }, version = "x" })).StatusCode); (await admin.PutAsJsonAsync($"/api/admin/users/{id}", new { username = "member", password = (string?)null, isAdmin = false, enabled = false })).EnsureSuccessStatusCode(); Assert.Equal(HttpStatusCode.Unauthorized, (await member.GetAsync("/api/auth/me")).StatusCode); }
    [Fact] public async Task ConnectionsNeverReturnPasswords() { using var f = new Factory(); using var c = f.CreateClient(); await Login(c); (await c.PostAsJsonAsync("/api/admin/connections", new { name = "Demo", host = "localhost", port = 3306, database = "demo", username = "demo", password = "must-not-appear", verifyTls = true })).EnsureSuccessStatusCode(); var json = await c.GetStringAsync("/api/admin/connections"); Assert.DoesNotContain("password", json, StringComparison.OrdinalIgnoreCase); Assert.DoesNotContain("must-not-appear", json); }
    [Fact] public void IdentifierQuotingEscapesBackticks() { Assert.Equal("`users``; DROP TABLE x;--`", DatabaseService.Quote("users`; DROP TABLE x;--")); }
}
