var _ = require('underscore');
var cheerio = require('cheerio');
var fs = require('fs');
var path = require('path');
var request = require('request');

function json_sanitize(text) {
    return text
        .replace(/\['/g, '["')
        .replace(/'\]/g, '"]')
        .replace(/',/g, '",')
        .replace(/,'/g, ',"');
}

function text_after(prefix, text) {
    return text.substring(text.indexOf(prefix) + prefix.length);
}

function text_before(text, suffix)  {
    return text.substring(0, text.indexOf(suffix));
}

function text_between(prefix, text, suffix) {
    return text_before(text_after(prefix, text), suffix);
}

function get_ebay_picture(context, url, callback) {
    var filename = context.auction_data.filenames[url];
    request(url, callback).pipe(fs.createWriteStream(path.join('pictures', filename)));
}

function add_url(data, context, url) {
    data.urls.push(url);
    var suffix = "-" + data.urls.length + url.substring(url.lastIndexOf(".")).toLowerCase();
    data.filenames[url] = (context.name + " " + context.id + suffix).replace("/", " ");
}

function scrape_data(context, html) {
    var $ = cheerio.load(html),
        image_element = $('div#JSDF').html(),
        args = '[' + text_between('rwidgets(', image_element, ');new (raptor') + ']',
        data = {
            id: context.id,
            seller: "",
            urls: [],
            suffix: {},
            filenames: {}
        };

    data.seller = $('div.ux-seller-section__item--seller').text();
    data.seller = data.seller.substr(0, data.seller.indexOf(' '));
    _.map(
        _.find(JSON.parse(json_sanitize(args)),
            function(item) {
                return item[0] === 'ebay.viewItem.PicturePanel';
            })[2]['fsImgList'],
        function(item) {
            var url = item['maxImageUrl'];
            if (url) {
                add_url(data, context, url);
            }
        });
    $('img').each(
        function(i, img) {
            var src = $(this).attr('src');
            if (src && src.match(/img\.auctiva\.com\/.*_tp\./)) {
                src = src.replace("_tp.", "_o.");
                add_url(data, context, src);
            }
        });
    return data;
}

function get_auction_data(context, callback) {
    request('http://www.ebay.com/itm/' + context.id,
        function(err, res, html) {
            if (err) {
                callback(err);
            } else {
                context.auction_data = scrape_data(context, html);
                callback();
            }
        });
}

exports.get_auction_data = get_auction_data;
exports.get_ebay_picture = get_ebay_picture;
