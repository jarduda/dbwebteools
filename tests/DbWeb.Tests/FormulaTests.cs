using DbWeb.Api;
using Xunit;

namespace DbWeb.Tests;

public class FormulaTests
{
    static readonly List<LayoutField> DropdownFields =
    [
        new(
            "name",
            "Friendly name",
            "",
            0,
            false,
            false,
            "dropdown",
            Options: [new("a", "Awaiting review"), new("b", "Łódź — ready"), new("7", "Seven")]
        ),
        new(
            "other",
            "Other",
            "",
            1,
            false,
            false,
            "dropdown",
            Options: [new("a", "Another label")]
        ),
    ];

    [Theory]
    [InlineData("DropdownDisplay('name', [name])", "a", "Awaiting review")]
    [InlineData("DropdownDisplay('other', [name])", "a", "Another label")]
    [InlineData("DropdownDisplay('name', [name])", "b", "Łódź — ready")]
    [InlineData("DropdownDisplay('name', [name])", "A", null)]
    [InlineData("DropdownDisplay('name', [name])", "legacy", null)]
    [InlineData("DropdownDisplay('name', [name])", null, null)]
    [InlineData("DropdownDisplay('name', 7)", "a", "Seven")]
    [InlineData(
        "Concat('Status: ', Upper(DropdownDisplay('name', [name])))",
        "a",
        "Status: AWAITING REVIEW"
    )]
    [InlineData("Coalesce(DropdownDisplay('name', [name]), 'Unknown')", "legacy", "Unknown")]
    public void ResolvesDropdownDisplayByFieldAndExactKey(
        string formula,
        string? key,
        string? expected
    )
    {
        var columns = Columns
            .Append(new ColumnInfo("other", "varchar", true, false, false, false, null))
            .ToList();
        var field = new LayoutField(
            "display",
            "Display",
            "",
            2,
            false,
            true,
            "formula",
            Formula: formula
        );
        var row = new RecordRow(new() { ["name"] = key }, "unchanged");
        Formulas.Populate([.. DropdownFields, field], columns, [row]);
        Assert.Empty(row.CalculationErrors);
        Assert.Equal(expected, row.JoinedValues["display"]);
        Assert.Equal(key, row.Values["name"]);
        Assert.Equal("unchanged", row.Version);
    }

    [Theory]
    [InlineData("DropdownDisplay('name')")]
    [InlineData("DropdownDisplay('name', 'a', 'b')")]
    [InlineData("DropdownDisplay([name], 'a')")]
    [InlineData("DropdownDisplay('Friendly name', 'a')")]
    [InlineData("DropdownDisplay('missing', 'a')")]
    [InlineData("DropdownDisplay('qty', 'a')")]
    [InlineData("DropdownDisplay('other', 'a')")]
    public void ValidatesDropdownFieldReferencesAtLayoutSave(string formula) =>
        Assert.Throws<ApiError>(() => Formulas.Compile(formula, Columns, DropdownFields));

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
