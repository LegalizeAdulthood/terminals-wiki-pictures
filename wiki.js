var _ = require('underscore');
var async = require('async');
var bot = require('nodemw');
var ebay = require('./ebay.js');
var util = require('util');
var debug = false;

var wiki;

var context = {
    name: "",
    manufacturer: "",
    model: "",
    auction_data: {},
    summary: function() {
        return "From {{ebay item|" + this.id + "|" + this.auction_data.seller + "}}\n"
            + "\n"
            + "[[Category:" + this.manufacturer + "|" + this.model + "]]";
    },
    file_list: function() {
        var self = this;
        return _.map(this.auction_data.urls,
            function(url) {
                return 'File:' + self.auction_data.filenames[url];
            });
    },
    gallery_markup: function() {
        return _.flatten(['<gallery>', this.file_list(), '</gallery>']).join("\n");
    },
    section_markup: function() {
        return "==Images==\n" + this.gallery_markup();
    },
    page_markup: function() {
        return [
            "{{infobox terminal",
            "| manufacturer = " + this.manufacturer,
            "| model = " + this.model,
            "| image =",
            "| intro_year =",
            "| intro_month =",
            "| intro_prior =",
            "| intro_price =",
            "| discontinued_year =",
            "| discontinued_month =",
            "| interface =",
            "| interface2 =",
            "| interface3 =",
            "| baud_rates =",
            "| display_size =",
            "| phosphor =",
            "| phosphor2 =",
            "| phosphor3 =",
            "| refresh_rate =",
            "| refresh_rate2 =",
            "| char_resolution =",
            "| char_resolution2 =",
            "| char_resolution3 =",
            "| char_resolution4 =",
            "| char_matrix =",
            "| char_cell =",
            "| graphic_type =",
            "| graphic_resolution =",
            "| cpu =",
            "| rom =",
            "| ram =",
            "| personality1 =",
            "| personality2 =",
            "| personality3 =",
            "| personality4 =",
            "| personality5 =",
            "| personality6 =",
            "| personality7 =",
            "| terminfo =",
            "}}",
            "",
            this.section_markup(),
            "",
            "[[Category:" + this.manufacturer + "|" + this.model + "]]",
            "{{stub}}"
        ].join("\n");
    }
};

function terminals_callback(callback) {
    return function(data) {
        callback();
    };
}

function upload_file(url, callback) {
    var name = context.auction_data.filenames[url];
    wiki.uploadByUrl(name, url, { text: context.summary() },
        terminals_callback(callback));
}

function transfer_picture(url, callback) {
    async.parallel([ _.partial(ebay.get_ebay_picture, context, url), _.partial(upload_file, url) ], callback);
}

function transfer_pictures(callback) {
    wiki.logIn(
        function(data) {
            async.eachLimit(context.auction_data.urls, 4, transfer_picture, callback);
        });
}

function edit_page(content, summary, callback) {
    wiki.edit(context.name, content, summary, terminals_callback(callback));
}

function add_image_content(content) {
    var matches = content.match(/^((.|\n)+== *Images *==\s+<gallery>\s+)((\n|[^<])+)(<\/gallery>(.|\n)+)$/),
        before, after;
    if (matches) {
        before = matches[1] + matches[3];
        after = "\n" + matches[5];
        return before + context.file_list().join("\n") + after;
    }

    matches = content.match(/^((.|\n)+)({{references}}(.|\n)+)$/i);
    if (matches) {
        return matches[1] + context.section_markup() + "\n\n" + matches[3];
    }

    return content + context.section_markup();
}

function add_gallery_markup(callback) {
    wiki.getArticle(context.name,
        function(content) {
            if (content) {
                edit_page(add_image_content(content), "Add images", callback);
            } else {
                edit_page(context.page_markup(), "Create page", callback);
            }
        });
}

exports.upload_pictures = function(server, args) {
    var bot_options = {
        'server': server,
        path: '/wiki',
        'debug': debug,
        silent: !debug
    };

    if (args.length !== 7) {
        console.log("Usage: node " + args[0] + " user password auction_id manufacturer model");
        return;
    }

    context.id = args[4];
    context.manufacturer = args[5];
    context.model = args[6];
    context.name = context.manufacturer + " " + context.model;
    wiki = new bot(bot_options);
    wiki.setConfig('username', args[2]);
    wiki.setConfig('password', args[3]);
    async.series([ _.partial(ebay.get_auction_data, context), transfer_pictures, add_gallery_markup ],
        function(err, results) {
            if (err) {
                util.log('ERROR: ' + err);
                throw err;
            }
        });
};

function download_auction_pictures(callback) {
    async.eachLimit(context.auction_data.urls, 4, _.partial(ebay.get_ebay_picture, context), callback);
}

exports.download_pictures = function(args) {
    context.id = args[2];
    context.manufacturer = args[3];
    context.model = args[4];
    context.name = context.manufacturer + " " + context.model;
    async.series([ _.partial(ebay.get_auction_data, context), download_auction_pictures ],
        function(err, results) {
            if (err) {
                util.log("ERROR: " + err);
                throw err;
            }
        });
};
