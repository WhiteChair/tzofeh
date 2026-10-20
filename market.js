/* Global Yield Matrix, central-bank decisions, and the AI Race tab.
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

  function heat(value, min, max) {
    const span = max - min || 1;
    const t = Math.min(1, Math.max(0, (value - min) / span));
    const r = Math.round(12 + (52 - 12) * t);
    const g = Math.round(72 + (176 - 72) * t);
    const b = Math.round(40 + (92 - 40) * t);
    const color = t > 0.84 ? "#062015" : "#ffffff";
    return { background: "rgb(" + r + "," + g + "," + b + ")", color: color };
  }

  function renderYields(data) {
    const host = document.getElementById("yield-matrix");
    if (!host) return;
    const countries = data.countries || [];
    const tenors = data.tenors || [];
    const numbers = [];
    countries.forEach(function (country) {
      tenors.forEach(function (tenor) {
        const value = country.yields ? country.yields[tenor] : null;
        if (typeof value === "number") numbers.push(value);
      });
    });
    const min = numbers.length ? Math.min.apply(null, numbers) : 0;
    const max = numbers.length ? Math.max.apply(null, numbers) : 1;
    let html = '<table class="yield-table"><thead><tr><th class="corner">Tenor</th>';
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
        const tone = heat(value, min, max);
        const shown = tenor === "1Y" ? fmtYield(value) + "%" : fmtYield(value);
        html +=
          '<td class="yield-cell" style="background:' +
          tone.background +
          ";color:" +
          tone.color +
          '">' +
          shown +
          "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    html += '<p class="yield-meta">As of: ';
    html += countries
      .map(function (country) {
        return "<strong>" + esc(country.code) + "</strong> " + esc(fmtDate(country.asOf));
      })
      .join(" · ");
    if (data.fetchedAt) html += ". File updated " + esc(fmtDate(data.fetchedAt));
    html += ".</p>";
    html += '<p class="yield-meta">' + esc(data.compoundingNote || "") + "</p>";
    html += '<ul class="yield-sources">';
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
    html +=
      '<p class="yield-meta">A dash means that tenor is not published. n/a means the tenor is left blank because the keyless feed does not include it. France’s other tenors fill in when a free Banque de France Webstat key is set on the weekday job.</p>';
    host.innerHTML = html;
  }

  function renderBanks(data) {
    const host = document.getElementById("cb-decisions");
    if (!host) return;
    const banks = data.banks || [];
    let html = '<div class="cb-grid">';
    banks.forEach(function (bank) {
      const verb = bank.action === "raised" ? "Raised" : bank.action === "cut" ? "Cut" : "Held";
      const bp = bank.changeBp ? " " + Math.abs(bank.changeBp) + " bp" : "";
      html += '<article class="card cb-card">';
      html +=
        '<div class="card-hdr"><span class="card-title">' +
        esc(bank.short) +
        " · " +
        esc((bank.countries || []).join(" ")) +
        "</span></div>";
      html += '<div class="cb-action cb-' + esc(bank.action) + '">' + esc(verb + bp) + "</div>";
      html += '<div class="cb-rate">' + esc(bank.rate) + "</div>";
      html += '<div class="cb-meta">' + esc(bank.rateLabel) + "</div>";
      html +=
        '<div class="cb-meta">Decision ' +
        esc(fmtDate(bank.decisionDate)) +
        (bank.effectiveDate && bank.effectiveDate !== bank.decisionDate
          ? " · effective " + esc(fmtDate(bank.effectiveDate))
          : "") +
        "</div>";
      html += '<p class="cb-note">' + esc(bank.summary) + " " + esc(bank.note || "") + "</p>";
      if (bank.needsReview) html += '<p class="cb-note cb-review">' + esc(bank.feedNote || "Rate feed differs from this decision.") + "</p>";
      html +=
        '<a class="cb-src" href="' +
        esc(bank.sourceUrl) +
        '" target="_blank" rel="noopener">' +
        esc(bank.bank) +
        " source</a>";
      html += "</article>";
    });
    html += "</div>";
    html += '<p class="cb-foot">Decisions recorded ' + esc(fmtDate(data.asOf)) + ". " + esc(data.note || "") + "</p>";
    host.innerHTML = html;
  }

  function renderRace(data) {
    const host = document.getElementById("tab-airace");
    if (!host) return;
    const models = data.models || [];
    let html = '<div class="matrix-hdr"><div>';
    html += '<div class="matrix-title">AI Race</div>';
    html +=
      '<div class="race-lead">Agent leaderboard as of ' +
      esc(fmtDate(data.asOf)) +
      ". " +
      esc((data.sessions || 0).toLocaleString("en-GB")) +
      " sessions. Score is " +
      esc(data.scoreName || "the published score") +
      '.</div></div><a class="refresh-btn" href="' +
      esc(data.sourceUrl) +
      '" target="_blank" rel="noopener">Arena leaderboard ↗</a></div>';
    html += '<div class="card" style="padding:0;overflow:auto"><table class="matrix-table race-table" style="min-width:640px"><thead><tr>';
    html += "<th>Rank</th><th>Model</th><th>Lab</th><th>Score</th></tr></thead><tbody>";
    models.forEach(function (row) {
      const margin = typeof row.margin === "number" ? " ± " + row.margin.toFixed(2) + "%" : "";
      html +=
        "<tr><td class=\"mono\">" +
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
    html += '<p class="cb-foot">' + esc(data.scoreNote || "") + "</p>";
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
        "</span><span class=\"badge bo\">Best rank " +
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
    fetch("data/yields.json")
      .then(function (res) {
        if (!res.ok) throw new Error("yields");
        return res.json();
      })
      .then(renderYields)
      .catch(function () {
        fail("yield-matrix", "Government bond yields could not be loaded.");
      });
    fetch("data/central-banks.json")
      .then(function (res) {
        if (!res.ok) throw new Error("banks");
        return res.json();
      })
      .then(renderBanks)
      .catch(function () {
        fail("cb-decisions", "Central-bank decisions could not be loaded.");
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
