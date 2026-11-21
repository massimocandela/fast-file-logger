import moment from "moment";
import fs from "fs";
import path from "path";
import {EventEmitter} from "events";

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Files are named <filename with %DATE%>, then <name>.1, <name>.2, ... when maxSize is reached within the same date
export default class RotatingFileStream extends EventEmitter {
    constructor({directory, filename, datePattern, useUTC, maxSize, maxFiles, symLink}) {
        super();
        this.directory = directory;
        this.filename = filename;
        this.datePattern = datePattern;
        this.useUTC = useUTC;
        this.maxSize = maxSize;
        this.maxFiles = maxFiles;
        this.symLink = symLink;
        this.hasDate = filename.includes("%DATE%");
        this.fileRegex = new RegExp(`^${escapeRegExp(filename).replaceAll("%DATE%", "(.+?)")}(?:\\.(\\d+))?$`);

        // Resume from the latest file of the current period after a restart
        this.date = this.getDate();
        const latest = this.listFiles().filter(file => file.date === this.date).pop();
        this.index = latest ? latest.index : 0;

        this.open();
        this.removeOldFiles();
    }

    getDate = () => {
        if (!this.hasDate) {
            return "";
        }
        return (this.useUTC ? moment.utc() : moment()).format(this.datePattern);
    };

    getFileName = () => {
        return this.filename.replaceAll("%DATE%", this.date) + (this.index > 0 ? `.${this.index}` : "");
    };

    // Only files that strictly match our naming scheme, oldest first
    listFiles = () => {
        return fs.readdirSync(this.directory, {withFileTypes: true})
            .filter(entry => entry.isFile())
            .map(entry => {
                const match = entry.name.match(this.fileRegex);
                if (!match) {
                    return null;
                }
                const date = this.hasDate ? match[1] : "";
                const time = this.hasDate ? (this.useUTC ? moment.utc : moment)(date, this.datePattern, true).valueOf() : 0;

                return {name: entry.name, date, time, index: Number(match[match.length - 1] || 0)};
            })
            .filter(file => file && !isNaN(file.time))
            .sort((a, b) => a.time - b.time || a.index - b.index);
    };

    open = () => {
        this.currentFile = path.join(this.directory, this.getFileName());
        this.size = fs.statSync(this.currentFile, {throwIfNoEntry: false})?.size ?? 0;
        // Opened synchronously so the file is on disk before retention runs
        this.fs = fs.createWriteStream(null, {fd: fs.openSync(this.currentFile, "a")});
        this.fs.on("error", error => this.emit("error", error));
        this.updateSymLink();
    };

    updateSymLink = () => {
        if (!this.symLink) {
            return;
        }
        const link = path.join(this.directory, this.symLink);
        try {
            if (fs.lstatSync(link, {throwIfNoEntry: false})?.isSymbolicLink()) {
                fs.unlinkSync(link);
            }
            fs.symlinkSync(path.basename(this.currentFile), link);
        } catch (error) {
            this.emit("error", error);
        }
    };

    removeOldFiles = () => {
        try {
            const files = this.listFiles();
            for (const file of files.slice(0, Math.max(0, files.length - this.maxFiles))) {
                fs.rmSync(path.join(this.directory, file.name), {force: true});
            }
        } catch (error) {
            this.emit("error", error);
        }
    };

    rotate = () => {
        const oldFile = this.currentFile;
        const oldStream = this.fs;
        this.open();
        const newFile = this.currentFile;
        oldStream.once("close", () => this.emit("rotate", oldFile, newFile));
        oldStream.end();
        this.removeOldFiles();
    };

    write = (data) => {
        const bytes = Buffer.byteLength(data);
        const date = this.getDate();

        if (date !== this.date) {
            this.date = date;
            this.index = 0;
            this.rotate();
        } else if (this.size > 0 && this.size + bytes > this.maxSize) {
            this.index++;
            this.rotate();
        }

        this.size += bytes;
        this.fs.write(data);
    };

    end = (callback) => {
        if (callback) {
            this.fs.once("close", callback);
        }
        this.fs.end();
    };
}
