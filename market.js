/* Global Yield Matrix, central-bank rows, and the AI Race tab.
   Loaded after the page script so the geopolitical matrix is already drawn. */
(function () {
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    if (/^\d{4}-\d{2}$/.test(iso)) {
      const [year, month] = iso.split("-").map(Number);
      const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
      return label + " avg";
    }
    const parsed = new Date(iso.slice(0, 10) + "T00:00:00Z");
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function fmtYield(value) {
    const negative = value < 0;
    const rounded = Math.round(Math.abs(value) * 100 + 1e-6) / 100;
    return (negative ? -rounded : rounded).toFixed(2);
  }

  function money(value) {
    const cents = Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
    const digits = value >= 1 || cents ? 2 : 3;
    return "$" + value.toFixed(digits).replace(/\.00$/, "");
  }

  function bankFor(code, banks) {
    return (banks || []).find(function (bank) {
      return (bank.countries || []).indexOf(code) >= 0;
    });
  }

  function decisionLabel(bank) {
    if (!bank) return { text: "—", cls: "" };
    const verb = bank.action === "raised" ? "Raised" : bank.action === "cut" ? "Lowered" : "Held";
    const bp = bank.changeBp ? " " + Math.abs(bank.changeBp) + " bp" : "";
    const cls = bank.action === "raised" ? "dec-raised" : bank.action === "cut" ? "dec-cut" : "dec-held";
    return { text: verb + bp, cls: cls };
  }

  function renderYields(data, bankFile) {
    const host = document.getElementById("yield-matrix");
    if (!host) return;
    const countries = data.countries || [];
    const tenors = data.tenors || [];
    const banks = (bankFile && bankFile.banks) || [];
    const numbers = [];
    countries.forEach(function (country) {
      tenors.forEach(function (tenor) {
        const value = country.yields ? country.yields[tenor] : null;
        if (typeof value === "number") numbers.push(value);
      });
    });
    const min = numbers.length ? Math.min.apply(null, numbers) : 0;
    const max = numbers.length ? Math.max.apply(null, numbers) : 1;

    let html = '<div class="card" style="padding:0;overflow:auto"><table class="yield-table"><thead><tr><th class="corner">Tenor</th>';
    countries.forEach(function (country) {
      html += "<th>" + esc(country.code) + "</th>";
    });
    html += "</tr></thead><tbody>";
    tenors.forEach(function (tenor) {
      html += '<tr><td class="tenor">' + esc(tenor) + "</td>";
      countries.forEach(function (country) {
        const value = country.yields ? country.yields[tenor] : null;
        const gap = country.gaps ? country.gaps[tenor] : "";
        if (typeof value !== "number") {
          const label = gap === "not_in_feed" ? "n/a" : "—";
          html += '<td class="yield-cell yield-empty">' + label + "</td>";
          return;
        }
        const span = max - min || 1;
        const t = Math.min(1, Math.max(0, (value - min) / span));
        const shown = tenor === "1Y" ? fmtYield(value) + "%" : fmtYield(value);
        html +=
          '<td class="yield-cell is-num' +
          (t > 0.62 ? " hot" : "") +
          '" style="--t:' +
          t.toFixed(3) +
          '">' +
          shown +
          "</td>";
      });
      html += "</tr>";
    });

    html += '<tr><td class="tenor">Last decision</td>';
    countries.forEach(function (country) {
      const decision = decisionLabel(bankFor(country.code, banks));
      html += '<td class="yield-cell yield-plain ' + decision.cls + '">' + esc(decision.text) + "</td>";
    });
    html += "</tr>";
    html += '<tr><td class="tenor">Policy rate</td>';
    countries.forEach(function (country) {
      const bank = bankFor(country.code, banks);
      html += '<td class="yield-cell yield-plain">' + esc(bank ? bank.rate : "—") + "</td>";
    });
    html += "</tr></tbody></table></div>";

    html += '<p class="yield-asof">As of ';
    html += countries
      .map(function (country) {
        return esc(country.code) + " " + esc(fmtDate(country.asOf));
      })
      .join(" · ");
    html += ".</p>";

    html += '<details class="yield-notes"><summary>Sources and methodology</summary>';
    html += "<p>" + esc(data.compoundingNote || "") + "</p>";
    html +=
      "<p>A dash means that tenor is not published. n/a means the tenor is left blank because the keyless feed does not include it. France’s other tenors fill in when a free Banque de France Webstat key is set on the weekday job. Darker green is a lower yield and brighter green is a higher yield, scaled across the cells on this table. DE, FR and IT share the ECB decision.</p>";
    html += "<ul class=\"yield-sources\">";
    countries.forEach(function (country) {
      html +=
        "<li><strong>" +
        esc(country.code) +
        "</strong> " +
        esc(country.method) +
        " — " +
        esc(country.note) +
        ' <a href="' +
        esc(country.sourceUrl) +
        '" target="_blank" rel="noopener">' +
        esc(country.source) +
        "</a></li>";
    });
    html += "</ul>";
    if (banks.length) {
      html += "<p>Central-bank decisions recorded " + esc(fmtDate(bankFile.asOf)) + ". " + esc(bankFile.note || "") + "</p><ul class=\"yield-sources\">";
      banks.forEach(function (bank) {
        const decision = decisionLabel(bank);
        html +=
          "<li><strong>" +
          esc(bank.short) +
          "</strong> " +
          esc(decision.text) +
          " to " +
          esc(bank.rate) +
          " (" +
          esc(bank.rateLabel) +
          "), decision " +
          esc(fmtDate(bank.decisionDate)) +
          ". " +
          esc(bank.summary) +
          " " +
          esc(bank.note || "") +
          ' <a href="' +
          esc(bank.sourceUrl) +
          '" target="_blank" rel="noopener">Source</a></li>';
      });
      html += "</ul>";
    }
    html += "</details>";
    host.innerHTML = html;
  }

  function labCountry(data) {
    const map = {};
    (data.labs || []).forEach(function (lab) {
      map[lab.lab] = lab.country;
    });
    return map;
  }

  function assess(top, countries) {
    const tally = {};
    top.forEach(function (row) {
      const country = countries[row.lab] || "Other";
      tally[country] = (tally[country] || 0) + 1;
    });
    const bits = Object.keys(tally).map(function (country) {
      const n = tally[country];
      const name = country === "United States" ? "US labs" : country === "China" ? "Chinese labs" : country + " labs";
      return n + (n === 1 ? " is" : " are") + " from " + name;
    });
    const first = top[0];
    const second = top[1];
    const gap = first && second ? (first.score - second.score).toFixed(2) : null;
    const top10 = top.slice(0, 10);
    const us10 = top10.filter(function (row) {
      return countries[row.lab] === "United States";
    }).length;
    const firstOther = top.find(function (row) {
      return countries[row.lab] && countries[row.lab] !== "United States";
    });
    let text = "Of these 20, " + bits.join(" and ") + ". ";
    if (first && second && gap) {
      text +=
        "The United States holds rank 1 and " +
        us10 +
        " of the top 10. " +
        first.model +
        " (" +
        first.lab +
        ") leads at " +
        first.score.toFixed(2) +
        "%, " +
        gap +
        " points ahead of " +
        second.model +
        ". ";
    }
    if (firstOther) {
      text +=
        "The highest model from outside the United States is " +
        firstOther.model +
        " (" +
        firstOther.lab +
        ", " +
        countries[firstOther.lab] +
        ") at rank " +
        firstOther.rank +
        ", on " +
        firstOther.score.toFixed(2) +
        "%.";
    }
    return { tally: tally, text: text };
  }

  function renderRace(data) {
    const host = document.getElementById("tab-airace");
    if (!host) return;
    const models = data.models || [];
    const top = models.slice(0, 20);
    const countries = labCountry(data);
    const summary = assess(top, countries);
    const pricing = data.pricing || { models: [] };
    const priceByName = {};
    (pricing.models || []).forEach(function (row) {
      if (typeof row.input === "number" && typeof row.output === "number") priceByName[row.model] = row;
    });
    const priced = top.filter(function (row) {
      return priceByName[row.model];
    });
    const unpriced = top.filter(function (row) {
      return !priceByName[row.model];
    });
    const maxOut = priced.reduce(function (max, row) {
      return Math.max(max, priceByName[row.model].output, priceByName[row.model].input);
    }, 1);

    let html = '<div class="matrix-hdr"><div>';
    html += '<div class="matrix-title">AI Race</div>';
    html +=
      '<div class="race-lead">Top 20 of the Arena agent leaderboard, as of ' +
      esc(fmtDate(data.asOf)) +
      ". " +
      esc((data.sessions || 0).toLocaleString("en-GB")) +
      " sessions. Score is " +
      esc(data.scoreName || "the published score") +
      '.</div></div><a class="refresh-btn" href="' +
      esc(data.sourceUrl) +
      '" target="_blank" rel="noopener">Arena leaderboard ↗</a></div>';

    html += '<div class="card race-summary"><div class="card-title" style="margin-bottom:8px">Top 20 by country</div>';
    html += "<p>" + esc(summary.text) + "</p></div>";

    html += '<div class="card" style="padding:0;overflow:auto"><table class="matrix-table race-table" style="min-width:640px"><thead><tr>';
    html += "<th>Rank</th><th>Model</th><th>Lab</th><th>Score</th></tr></thead><tbody>";
    top.forEach(function (row) {
      const margin = typeof row.margin === "number" ? " ± " + row.margin.toFixed(2) + "%" : "";
      html +=
        '<tr><td class="mono">' +
        esc(row.rank) +
        "</td><td>" +
        esc(row.model) +
        "</td><td>" +
        esc(row.lab) +
        '</td><td class="mono">' +
        (typeof row.score === "number" ? row.score.toFixed(2) + "%" + margin : "—") +
        "</td></tr>";
    });
    html += "</tbody></table></div>";

    html += '<h2 class="section-title">Cost per million tokens</h2>';
    html += '<div class="card">';
    html +=
      '<p class="race-lead" style="margin-bottom:10px">Standard public API price, USD per 1 million tokens, checked ' +
      esc(fmtDate(pricing.asOf)) +
      ". Input and output only.</p>";
    html +=
      '<div class="cost-legend"><span><i class="cost-swatch us"></i>United States</span><span><i class="cost-swatch cn"></i>China</span></div>';
    html += '<div class="cost-chart">';
    priced.forEach(function (row) {
      const price = priceByName[row.model];
      const country = countries[row.lab] === "China" ? "cn" : "us";
      html += '<div class="cost-model">' + esc(row.rank) + ". " + esc(row.model) + "</div>";
      [
        ["In", price.input],
        ["Out", price.output],
      ].forEach(function (pair) {
        const width = Math.max(1.2, (pair[1] / maxOut) * 100);
        html +=
          '<div class="cost-line"><span class="cost-kind">' +
          pair[0] +
          '</span><div class="cost-track"><div class="cost-fill ' +
          country +
          '" style="width:' +
          width.toFixed(2) +
          '%"></div></div><span class="cost-val">' +
          esc(money(pair[1])) +
          "</span></div>";
      });
    });
    html += "</div>";
    if (unpriced.length) {
      html +=
        '<p class="cb-foot">No public price, left off the chart: ' +
        esc(
          unpriced
            .map(function (row) {
              return row.model;
            })
            .join(", ")
        ) +
        ".</p>";
    }
    html += "</div>";

    html += '<details class="yield-notes"><summary>Pricing sources</summary>';
    html += "<p>" + esc(pricing.note || "") + "</p><ul class=\"yield-sources\">";
    (pricing.models || []).forEach(function (row) {
      html +=
        "<li><strong>" +
        esc(row.model) +
        "</strong> " +
        (typeof row.input === "number" ? "in " + esc(money(row.input)) + " · out " + esc(money(row.output)) + ". " : "n/a. ") +
        esc(row.note || "") +
        (row.sourceUrl
          ? ' <a href="' + esc(row.sourceUrl) + '" target="_blank" rel="noopener">' + esc(row.sourceLabel || "Source") + "</a>"
          : "") +
        "</li>";
    });
    unpriced.forEach(function (row) {
      const listed = (pricing.models || []).some(function (item) {
        return item.model === row.model;
      });
      if (!listed) html += "<li><strong>" + esc(row.model) + "</strong> n/a. No verified public API price.</li>";
    });
    html += "</ul><p>" + esc(data.scoreNote || "") + "</p></details>";

    html += '<h2 class="section-title">Top 10 labs</h2>';
    html += '<div class="lab-grid">';
    (data.labs || []).forEach(function (lab) {
      let head;
      if (lab.samePerson) head = "Same person as the CEO. " + (lab.headOfAiNote || "");
      else if (!lab.headOfAi) head = lab.headOfAiNote || "No single head of AI is named.";
      else head = lab.headOfAi + (lab.headOfAiTitle ? ", " + lab.headOfAiTitle + ". " : ". ") + (lab.headOfAiNote || "");
      html += '<article class="card lab-card">';
      html +=
        '<div class="card-hdr"><span class="card-title">' +
        esc(lab.flag) +
        " " +
        esc(lab.lab) +
        '</span><span class="badge bo">Best rank ' +
        esc(lab.bestRank) +
        "</span></div>";
      html += '<div class="lab-country">' + esc(lab.flag) + " " + esc(lab.country) + "</div>";
      html += '<p class="lab-line"><span>CEO</span> ' + esc(lab.ceo) + (lab.ceoTitle ? ", " + esc(lab.ceoTitle) : "") + "</p>";
      if (lab.ceoNote) html += '<p class="cb-note">' + esc(lab.ceoNote) + "</p>";
      html += '<p class="lab-line"><span>Head of AI</span> ' + esc(head) + "</p>";
      if (lab.sourceUrl) {
        html += '<a class="cb-src" href="' + esc(lab.sourceUrl) + '" target="_blank" rel="noopener">' + esc(lab.sourceLabel || "Source") + "</a>";
      }
      html += "</article>";
    });
    html += "</div>";
    host.innerHTML = html;
  }

  function fail(id, message) {
    const host = document.getElementById(id);
    if (host) host.innerHTML = '<p class="cb-foot">' + esc(message) + "</p>";
  }

  function boot() {
    Promise.all([
      fetch("data/yields.json").then(function (res) {
        if (!res.ok) throw new Error("yields");
        return res.json();
      }),
      fetch("data/central-banks.json").then(function (res) {
        if (!res.ok) throw new Error("banks");
        return res.json();
      }),
    ])
      .then(function (pair) {
        renderYields(pair[0], pair[1]);
      })
      .catch(function () {
        fetch("data/yields.json")
          .then(function (res) {
            if (!res.ok) throw new Error("yields");
            return res.json();
          })
          .then(function (yields) {
            renderYields(yields, null);
          })
          .catch(function () {
            fail("yield-matrix", "Government bond yields could not be loaded.");
          });
      });
    fetch("data/ai-race.json")
      .then(function (res) {
        if (!res.ok) throw new Error("race");
        return res.json();
      })
      .then(renderRace)
      .catch(function () {
        fail("tab-airace", "The AI Race snapshot could not be loaded.");
      });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
