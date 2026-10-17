// Entry point for the hotel search suite (everything lives in hotel_search/).
//   node search.js                                   table + output/*.csv/json for the settings.js defaults
//   node search.js --city=Paris --country-code=FR --sources=xotelo,searchapi
//   node search.js --json ...                        prints the records as one JSON line (used by server.js)
// Any value in hotel_search/settings.js can be overridden with --kebab-case=value.
const { search } = require("./hotel_search");
const { toRecord, printReport, writeReport } = require("./hotel_search/report");

const RESULT_MARKER = "@@RESULT@@";   // server.js looks for this prefix on the JSON line
const REPORT_MARKER = "@@REPORT@@";   // ...and this one for what every API returned and what the city check dropped

search()
    .then(hotels => {
        if (process.argv.includes("--json")) {
            console.log(`${REPORT_MARKER}${JSON.stringify(search.lastReport)}`);
            console.log(`${RESULT_MARKER}${JSON.stringify(hotels.map(toRecord))}`);
            return;
        }
        printReport(hotels);
        writeReport(hotels);
    })
    .catch(error => {
        console.error("Error:", error.message);
        process.exit(1);
    });
