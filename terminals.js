var wiki = require('./wiki.js');

if (process.argv.length === 7) {
    wiki.upload_pictures('terminals-wiki.org', process.argv);
} else if (process.argv.length === 5) {
    wiki.download_pictures(process.argv);
}
