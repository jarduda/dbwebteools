using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace DbWeb.Api;

public static class TableAccess
{
    public static async Task<DatabaseConnection> Access(
        AppDb db,
        HttpContext c,
        int id,
        string table,
        string op
    )
    {
        if (!c.User.IsInRole("Admin"))
        {
            var uid = int.Parse(c.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var g = await db.Grants.SingleOrDefaultAsync(x =>
                x.UserId == uid && x.ConnectionId == id && x.Table == table
            );
            if (
                g == null
                || !g.Read
                || !(
                    op switch
                    {
                        "create" => g.Create,
                        "update" => g.Update,
                        "delete" => g.Delete,
                        _ => g.Read,
                    }
                )
            )
                throw new ApiError(403, "You do not have permission for this operation.");
        }
        return await db.Connections.FindAsync(id)
            ?? throw new ApiError(404, "Connection not found.");
    }
}
