// Child process used by server.js: runs the search suite with CLI-style settings and prints the
// hotels as JSON on a marked last line, e.g.
//   node search-json.js --city=Paris --country-code=FR
// A separate process per search is needed because settings.js reads process.argv once at load time.
const { search } = require("./search");
const { toRecord } = require("./report");

search()
    .then(hotels => {
        console.log(`@@RESULT@@${JSON.stringify(hotels.map(toRecord))}`);
    })
    .catch(error => {
        console.error("Error:", error.message);
        process.exit(1);
    });
