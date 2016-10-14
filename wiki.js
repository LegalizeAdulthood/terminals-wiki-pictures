var _ = require('underscore');
var async = require('async');
var bot = require('nodemw');
var cheerio = require('cheerio');
var fs = require('fs');
var http = require('http');
var path = require('path');
var request = require('request');
var util = require('util');
var debug = false;

var wiki;

function json_sanitize(text) {
    return text
        .replace(/\['/g, '["')
        .replace(/'\]/g, '"]')
        .replace(/',/g, '",')
        .replace(/,'/g, ',"');
}

var context = {
    id: 0,
    seller: "",
    name: "",
    manufacturer: "",
    model: "",
    filename: function(url) {
        return (this.name + ' ' + this.id + this.suffix[url]).replace('/', ' ');
    },
    urls: [],
    suffix: {},
    add_url: function(url) {
        this.urls.push(url);
        this.suffix[url] = '-' + this.urls.length + url.substring(url.lastIndexOf('.')).toLowerCase();
    },
    scrape_data: function(html) {
        var $ = cheerio.load(html),
            image_element = $('div#JSDF').html(),
            args = '[' + text_between('rwidgets(', image_element, ');new (raptor') + ']',
            auctiva_images = $('img.auctionImage'),
            self = this;
        this.seller = $('div.si-content span.mbg-nw').html();
        _.map(
            _.find(JSON.parse(json_sanitize(args)),
                function(item) {
                    return item[0] === 'ebay.viewItem.PicturePanel';
                })[2]['fsImgList'],
            function(item) {
                var url = item['maxImageUrl'];
                if (url) {
                    self.add_url(url);
                }
            });
        $('img').each(
            function(i, img) {
                var src = $(this).attr('src');
                if (src && src.match(/img\.auctiva\.com\/.*_tp\./)) {
                    src = src.replace("_tp.", "_o.");
                    self.add_url(src);
                }
            });
    },
    summary: function() {
        return "From {{ebay item|" + this.id + "|" + this.seller + "}}\n"
            + "\n"
            + "[[Category:" + this.manufacturer + "|" + this.model + "]]";
    },
    file_list: function() {
        var self = this;
        return _.map(this.urls,
            function(url) {
                return 'File:' + self.filename(url);
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
            "| persaonlity7 =",
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

function text_after(prefix, text) {
    return text.substring(text.indexOf(prefix) + prefix.length);
}

function text_before(text, suffix)  {
    return text.substring(0, text.indexOf(suffix));
}

function text_between(prefix, text, suffix) {
    return text_before(text_after(prefix, text), suffix);
}

function get_ebay_picture(url, callback) {
    var filename = context.filename(url);
    request(url, callback).pipe(fs.createWriteStream(path.join('pictures', filename)));
}

function get_auction_data(callback) {
    request('http://www.ebay.com/itm/' + context.id,
        function(err, res, data) {
            if (err) {
                callback(err);
            } else {
                context.scrape_data(data);
                callback();
            }
        });
}

function terminals_callback(callback) {
    return function(data) {
        callback();
    };
}

function upload_file(url, callback) {
    var name = context.filename(url);
    wiki.uploadByUrl(name, url, { text: context.summary() },
        terminals_callback(callback));
}

function transfer_picture(url, callback) {
    async.parallel([ _.partial(get_ebay_picture, url), _.partial(upload_file, url) ], callback);
}

function transfer_pictures(callback) {
    wiki.logIn(
        function(data) {
            async.eachLimit(context.urls, 4, transfer_picture, callback);
        });
}

function edit_page(content, summary, callback) {
    wiki.edit(context.name, content, summary, terminals_callback(callback));
}

function add_image_content(content) {
    var matches = content.match(/^((.|\n)+== *Images *==\s+<gallery>\s+)((\n|[^<])+)(<\/gallery>(.|\n)+)$/),
        before, after, new_content;
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

exports.main = function(server, args) {
    var bot_options = {
        'server': server,
        path: '/wiki',
        'debug': debug,
        silent: !debug
    };

    if (args.length != 7) {
        console.log("Usage: node " + args[0] + " user password auction_id manufacturer model");
        return;
    }

    context.id = args[4];
    context.manufacturer = args[5];
    context.model = args[6];
    context.name = context.manufacturer + ' ' + context.model;
    wiki = new bot(bot_options);
    wiki.setConfig('username', args[2]);
    wiki.setConfig('password', args[3]);
    async.series([ get_auction_data, transfer_pictures, add_gallery_markup ],
        function(err, results) {
            if (err) {
                util.log('ERROR: ' + err);
                throw err;
            }
        });
}
