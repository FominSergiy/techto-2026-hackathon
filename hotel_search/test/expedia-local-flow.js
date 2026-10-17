// Offline end-to-end test of expedia.js against a LOCAL fake server (127.0.0.1, synthetic markup, not
// Expedia's): pagination via "Show more", dedupe/ranking, HTML dump, and the headless bot-check error.
// Run: node test/expedia-local-flow.js   (no external network)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const card = (name, price) => `<div data-stid="lodging-card-responsive"><a href="/Hotel-Information/${name}"><h3>${name}</h3></a><div>8.4/10 Very Good (120 reviews)</div><div>$${price} nightly</div><div>$${price} total</div></div>`;
const PAGE_ONE = [card("Hotel A", 150), card("Hotel B", 90)];
const PAGE_TWO = [card("Hotel C", 120), card("Hotel A", 140)];  // A again, cheaper

let mode = "results";
const server = http.createServer((request, response) => {
    if (mode === "bot") {
        response.writeHead(429, { "Content-Type": "text/html" });
        return response.end("<html><head><title>Bot or Not?</title></head><body>Are you a person?</body></html>");
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<html><body><div id="list">${PAGE_ONE.join("")}</div><button id="more">Show more</button>
        <script>document.getElementById("more").addEventListener("click", function () {
            document.getElementById("list").insertAdjacentHTML("beforeend", ${JSON.stringify(PAGE_TWO.join(""))});
            this.remove();
        });</script></body></html>`);
});

async function main() {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const dump = path.join(os.tmpdir(), "expedia-dump-test.html");
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "expedia-profile-"));
    process.env.EXPEDIA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.EXPEDIA_PROFILE_DIR = profile;
    process.env.EXPEDIA_DUMP_HTML = dump;
    process.argv.push("--max-nightly-price=null", "--min-rating=null", "--min-reviews=null", "--target-count=10", "--nights=1");
    const { search } = require("../expedia");

    try {
        const hotels = await search();
        assert.deepEqual(hotels.map(h => [h.name, h.nightlyPrice]), [["Hotel B", 90], ["Hotel C", 120], ["Hotel A", 140]]);
        assert.equal(hotels[0].rating, 4.2);
        assert.ok(fs.readFileSync(dump, "utf8").includes("Hotel C"), "dump contains the page after Show more");
        console.log("pagination, dedupe, ranking and dump: ok");

        mode = "bot";
        await assert.rejects(search(), /HEADLESS=false/);
        console.log("headless bot check gives a clear error: ok");
    } finally {
        server.close();
        fs.rmSync(profile, { recursive: true, force: true });
        fs.rmSync(dump, { force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
