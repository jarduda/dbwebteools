using DbWeb.Api;
using Xunit;

namespace DbWeb.Tests;

public class FormulaTests
{
    static readonly List<ColumnInfo> Columns =
    [
        new("price", "decimal", true, false, false, false, null),
        new("qty", "int", true, false, false, false, null),
        new("name", "varchar", true, false, false, false, null),
    ];

    [Theory]
    [InlineData("Round([price] * [qty], 2)", "24.69")]
    [InlineData("[price] + 0.005", "12.350")]
    [InlineData("Concat(Upper(Trim([name])), ' / ', Lower('ABC'))", "ALICE / abc")]
    [InlineData("Replace(Substring(Trim([name]), 0, 3), 'Ali', 'Hello')", "Hello")]
    [InlineData("Length(Trim([name]))", "5")]
    [InlineData("if([qty] > 1, Max(3, [qty]), Min(1, [qty]))", "3")]
    public void CalculatesTypedValuesOnServer(string formula, string expected)
    {
        var row = new RecordRow(
            new()
            {
                ["price"] = "12.345",
                ["qty"] = 2,
                ["name"] = " Alice ",
            },
            "original"
        );
        var field = new LayoutField(
            "computed",
            "Calculated",
            "",
            0,
            false,
            true,
            "formula",
            Formula: formula
        );
        Formulas.Populate([field], Columns, [row]);
        Assert.Empty(row.CalculationErrors);
        Assert.Equal(expected, row.JoinedValues["computed"]);
        Assert.Equal("original", row.Version);
        Assert.False(row.Values.ContainsKey("computed"));
    }

    [Theory]
    [InlineData("[unknown] + 1")]
    [InlineData("System.IO.File.ReadAllText('/etc/passwd')")]
    [InlineData("Secret([name])")]
    [InlineData("[price] + (")]
    [InlineData("Round([price])")]
    [InlineData("[qty] ** 999999")]
    public void RejectsInvalidOrUnsupportedExpressions(string formula) =>
        Assert.Throws<ApiError>(() => Formulas.Compile(formula, Columns));

    [Fact]
    public void HandlesNullErrorsAndExactLargeNumbersWithoutFailingPage()
    {
        var field = new LayoutField(
            "calc",
            "Calculated",
            "",
            0,
            false,
            true,
            "formula",
            Formula: "Coalesce([price], 0) + 1"
        );
        var rows = new List<RecordRow>
        {
            new(new() { ["price"] = null }, ""),
            new(new() { ["price"] = "9007199254740993.1234" }, ""),
        };
        Formulas.Populate([field], Columns, rows);
        Assert.Equal("1", rows[0].JoinedValues["calc"]);
        Assert.Equal("9007199254740994.1234", rows[1].JoinedValues["calc"]);
        Formulas.Populate([field with { Formula = "[price] / 0" }], Columns, rows);
        Assert.All(rows, row => Assert.Null(row.JoinedValues["calc"]));
        Assert.Empty(rows[0].CalculationErrors); // Arithmetic propagates NULL.
        Assert.NotEmpty(rows[1].CalculationErrors);
        Assert.Throws<ApiError>(() => Formulas.Compile(new string('(', 1025), Columns));
        Assert.Throws<ApiError>(() =>
            Formulas.Compile(new string('(', 33) + "1" + new string(')', 33), Columns)
        );
    }
}
