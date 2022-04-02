# fast-file-logger

This is a file logger that supports file rotation and compression.
It create a persistent stream on the file and it does just what it has to, with the minimum overhead and memory footprint.
It is useful if you want to be able to handle a constant flow of (or bursts of) logs.

## How to install it

```
npm install fast-file-logger
```

## How to initialize it

```js
const logger = new FileLogger({
    logRotatePattern: 'YYYY-MM-DD',              // The date pattern that will be used to rotate the file
    filename: 'error-%DATE%.log',                // The file name, optionally including the pattern
    symLink: 'error.log',                        // The name of the symlink to the latest file, disabled if null
    directory: '/var/www/log/',                  // The directory containing the logs
    maxRetainedFiles: 10,                        // How many files will be retained, the rest are deleted
    maxFileSizeMB: 60,                           // Amount of MB before the file is rotated, independently from the date pattern (.1, .2, etc. is prepended)
    compressOnRotation: false,                   // Compress the file on rotation
    label: 'production',                         // A label that will be prepended to each log. You can use labels to distinguish different logger instances to the same file
    useUTC: true,                                // Use UTC for the timestamp in the logs, use local timezone otherwise
    format: ({data, timestamp}) => `${timestamp} ${data.level}: ${data.message}` // The format of the log
});
```


## How to use it

```js
  logger.log({
      level: 'error',
      message: 'The error message'
  });
```

If you want to split different logs levels in different files, you can simply create different instances of the logger.


```js
const loggerTransports = {
    verbose: logger1,
    error: logger2,
    info: logger3
};
```

And you create your own logger

```js
const logger = (data) => loggerTransports[data.level];
```

The rest remains the same:
```js
logger.log({
    level: 'error',
    message: 'The error message'
});
```

