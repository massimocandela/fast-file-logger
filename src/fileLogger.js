import moment from "moment";
import zlib from "zlib";
import fs from "fs";
import {pipeline} from "stream";
import RotatingFileStream from "./rotatingFileStream.js";

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

        this.stream = new RotatingFileStream({
            directory: this.directory,
            filename: this.filename,
            datePattern: this.logRotatePattern,
            useUTC: this.useUTC,
            maxSize: this.maxFileSizeMB * 1024 * 1024,
            maxFiles: this.maxRetainedFiles,
            symLink: this.symLinkName
        });
        this.stream.on("error", console.log);

        if (this.compressOnRotation) {
            this.stream.on("rotate", (oldFile) => {
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

    getCurrentFile = () => {
        return this.stream.currentFile;
    };
};