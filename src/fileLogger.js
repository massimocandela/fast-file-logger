import moment from "moment";
import {getStream} from "file-stream-rotator";
import zlib from "zlib";
import fs from "fs";
import {pipeline} from "stream";

export default class FileLogger {
    constructor(params) {
        this.format = params.format || this.defaultFormat;
        this.logRotatePattern = params.logRotatePattern || "YYYY-MM-DD";
        this.filename = params.filename;
        this.symLinkName = params.symLink;
        this.useUTC = params.useUTC;
        this.directory = params.directory;
        this.levels = params.levels || ["error", "info", "verbose"];

        // File rotation
        this.compressOnRotation = params.compressOnRotation;
        this.maxFileSizeMB = parseFloat(params.maxFileSizeMB || 20);
        this.maxRetainedFiles = parseFloat(params.maxRetainedFiles || 20);

        if (!fs.existsSync(this.directory)) {
            fs.mkdirSync(this.directory);
        }

        const streamOptions = {
            filename: `${this.directory}/${this.filename}`,
            // file-stream-rotator only parses integer sizes
            size: `${Math.max(1, Math.round(this.maxFileSizeMB * 1024))}k`,
            frequency: "custom",
            end_stream: true,
            max_logs: this.maxRetainedFiles,
            date_format: this.logRotatePattern,
            utc: this.useUTC,
            create_symlink: !!this.symLinkName,
            symlink_name: this.symLinkName,
            verbose: false,
            audit_file: this.symLinkName ? `${this.directory}/.${this.symLinkName.replace(".log", "")}` : null
        };

        this.stream = getStream(streamOptions);

        if (this.compressOnRotation) {
            this.stream.on("rotate", (oldFile) => {
                if (!oldFile) {
                    return;
                }
                const tmpFile = oldFile + ".tmp";
                pipeline(fs.createReadStream(oldFile), zlib.createGzip(), fs.createWriteStream(tmpFile), (error) => {
                    try {
                        if (error) {
                            fs.rmSync(tmpFile, {force: true});
                            console.log(error);
                        } else {
                            fs.renameSync(tmpFile, oldFile);
                        }
                    } catch (error) {
                        console.log(error); // Nothing else we can do
                    }
                });
            });
        }

    };

    defaultFormat = (json) => {
        return JSON.stringify(json);
    };

    getCurrentDate = () => {
        if (this.useUTC) {
            return moment.utc();
        } else {
            return moment();
        }
    };

    log = (data) => {
        try {
            const item = this.format({
                timestamp: this.getCurrentDate().format("YYYY-MM-DDTHH:mm:ssZ"),
                data
            });
            this.stream.write(item + "\n");
        } catch (error) {
            console.log(data);
            console.log(error);
        }
    };

    // v1 appends a size index (.0, .1, ...) to the name, so ask the rotator instead of rebuilding it
    getCurrentFile = () => {
        return this.stream.currentFile;
    };
};