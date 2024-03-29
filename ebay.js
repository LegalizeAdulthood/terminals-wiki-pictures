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
        .replace(/,'/g, ',"')
        .replace(/\\u002F/g, '/');
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
    args = JSON.parse(json_sanitize(args));
    var picturePanel = _.find(args,
            function(item) {
                return item[0] === 'ebay.viewItem.PicturePanel';
            });
    if (picturePanel) {
        var fsImageList = picturePanel[2]['fsImgList'];
        _.map(fsImageList,
            function(item) {
                var url = item['maxImageUrl'];
                if (!url) {
                    url = item['displayImgUrl'];
                }
                if (url) {
                    add_url(data, context, url);
                }
            });
    } else {
        args = '{"p":"PICTURE"' + text_between('"PICTURE"', html, ')</script>');
        args = JSON.parse(args);
        _.map(args['w'][0][2]['model']['mediaList'],
            function(item) {
                url = item['image']['zoomImg']['URL'];
                add_url(data, context, url);
            });
    }
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
