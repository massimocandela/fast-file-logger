const {expect} = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const moment = require("moment");

const FileLogger = require("../src/fileLogger.js").default;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const waitFor = async (condition, timeout = 2000) => {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeout) {
            throw new Error("Timeout waiting for condition");
        }
        await wait(20);
    }
};

const close = (logger) => new Promise(resolve => logger.stream.end(resolve));

const readLines = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean);

const logFiles = (directory) => fs.readdirSync(directory, {withFileTypes: true})
    .filter(f => f.isFile() && /^app-.*\.log(\.\d+)?$/.test(f.name))
    .map(f => path.join(directory, f.name));

describe("FileLogger", function () {
    let directory;

    const createLogger = (params = {}) => new FileLogger({
        directory,
        filename: "app-%DATE%.log",
        symLink: "app.log",
        ...params
    });

    beforeEach(() => {
        directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ffl-test-")), "logs");
    });

    afterEach(() => {
        fs.rmSync(path.dirname(directory), {recursive: true, force: true});
    });

    it("creates the log directory if missing", async () => {
        const logger = createLogger();
        expect(fs.existsSync(directory)).to.equal(true);
        await close(logger);
    });

    it("names the first file using the date pattern without a size index", async () => {
        const logger = createLogger();
        const expected = path.join(directory, `app-${moment().format("YYYY-MM-DD")}.log`);

        expect(path.normalize(logger.getCurrentFile())).to.equal(expected);
        await close(logger);
    });

    it("supports a custom rotation pattern", async () => {
        const logger = createLogger({logRotatePattern: "YYYY-MM"});

        expect(path.basename(logger.getCurrentFile())).to.equal(`app-${moment().format("YYYY-MM")}.log`);
        await close(logger);
    });

    it("writes JSON lines with timestamp and data by default", async () => {
        const logger = createLogger();
        logger.log({level: "info", message: "hello"});
        logger.log({level: "error", message: "world"});
        await close(logger);

        const lines = readLines(logger.getCurrentFile()).map(JSON.parse);
        expect(lines).to.have.length(2);
        expect(lines[0].data).to.deep.equal({level: "info", message: "hello"});
        expect(lines[1].data).to.deep.equal({level: "error", message: "world"});
        expect(moment(lines[0].timestamp, "YYYY-MM-DDTHH:mm:ssZ", true).isValid()).to.equal(true);
    });

    it("uses the custom format function", async () => {
        const logger = createLogger({
            format: ({data, timestamp}) => `${timestamp} ${data.level}: ${data.message}`
        });
        logger.log({level: "info", message: "hello"});
        await close(logger);

        const [line] = readLines(logger.getCurrentFile());
        expect(line).to.match(/^\S+ info: hello$/);
    });

    it("uses UTC timestamps when useUTC is set", async () => {
        const logger = createLogger({useUTC: true});
        logger.log({message: "utc"});
        await close(logger);

        const [line] = readLines(logger.getCurrentFile()).map(JSON.parse);
        expect(line.timestamp).to.match(/\+00:00$/);
        expect(path.basename(logger.getCurrentFile())).to.equal(`app-${moment.utc().format("YYYY-MM-DD")}.log`);
    });

    it("does not throw when the format function fails", async () => {
        const logger = createLogger({
            format: () => {
                throw new Error("format error");
            }
        });
        const originalLog = console.log;
        console.log = () => {};
        try {
            expect(() => logger.log({message: "x"})).to.not.throw();
        } finally {
            console.log = originalLog;
        }
        await close(logger);
    });

    it("creates a symlink to the current file", async () => {
        const logger = createLogger();
        logger.log({message: "x"});
        await close(logger);

        const link = path.join(directory, "app.log");
        expect(fs.lstatSync(link).isSymbolicLink()).to.equal(true);
        expect(fs.readlinkSync(link)).to.equal(path.basename(logger.getCurrentFile()));
    });

    it("rotates when the max file size is reached", async () => {
        const logger = createLogger({maxFileSizeMB: 0.001}); // 1KB
        const first = logger.getCurrentFile();

        for (let i = 0; i < 30; i++) {
            logger.log({i, message: "x".repeat(50)});
        }
        await close(logger);

        expect(logger.getCurrentFile()).to.not.equal(first);
        expect(logFiles(directory)).to.include(`${first}.1`);
    });

    it("resumes from the latest file after a restart", async () => {
        const logger = createLogger({maxFileSizeMB: 0.001});
        for (let i = 0; i < 30; i++) {
            logger.log({i, message: "x".repeat(50)});
        }
        await close(logger);

        const restarted = createLogger({maxFileSizeMB: 0.001});
        expect(restarted.getCurrentFile()).to.equal(logger.getCurrentFile());
        await close(restarted);
    });

    it("keeps at most maxRetainedFiles files", async () => {
        const logger = createLogger({maxFileSizeMB: 0.001, maxRetainedFiles: 3});

        for (let i = 0; i < 100; i++) {
            logger.log({i, message: "x".repeat(50)});
        }
        await close(logger);

        expect(logFiles(directory)).to.have.length(3);
    });

    it("compresses rotated files when compressOnRotation is set", async () => {
        const logger = createLogger({maxFileSizeMB: 0.001, compressOnRotation: true});
        const first = logger.getCurrentFile();

        let i = 0;
        while (logger.getCurrentFile() === first) {
            logger.log({i: i++, message: "x".repeat(50)});
            await wait(5);
        }
        await close(logger);

        const isGzipped = () => {
            try {
                zlib.gunzipSync(fs.readFileSync(first));
                return true;
            } catch {
                return false;
            }
        };
        await waitFor(isGzipped);

        const lines = zlib.gunzipSync(fs.readFileSync(first)).toString().split("\n").filter(Boolean);
        expect(lines.length).to.be.greaterThan(0);
        expect(JSON.parse(lines[0]).data.i).to.equal(0);
        expect(fs.existsSync(first + ".tmp")).to.equal(false);

        // The active file is never compressed
        expect(() => zlib.gunzipSync(fs.readFileSync(logger.getCurrentFile()))).to.throw();
    });
});
