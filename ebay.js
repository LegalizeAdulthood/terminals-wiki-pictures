var cheerio = require('cheerio');
var fs = require('fs');
var path = require('path');
var request = require('request');
var browser = require('./browser.js');

var image_extensions = {
    '.gif': true,
    '.jpg': true,
    '.jpeg': true,
    '.png': true,
    '.webp': true
};

var request_headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

function json_sanitize(text) {
    return text
        .replace(/\['/g, '["')
        .replace(/'\]/g, '"]')
        .replace(/',/g, '",')
        .replace(/,'/g, ',"')
        .replace(/\\u002F/g, '/');
}

function text_after(prefix, text) {
    var index = text.indexOf(prefix);
    if (index === -1) {
        return "";
    }
    return text.substring(index + prefix.length);
}

function text_before(text, suffix)  {
    var index = text.indexOf(suffix);
    if (index === -1) {
        return "";
    }
    return text.substring(0, index);
}

function text_between(prefix, text, suffix) {
    return text_before(text_after(prefix, text), suffix);
}

function parse_json(text) {
    try {
        return JSON.parse(text);
    } catch (err) {
        return null;
    }
}

function html_decode(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function normalize_url(url) {
    if (!url) {
        return "";
    }
    url = html_decode(String(url))
        .replace(/\\u002F/g, '/')
        .replace(/\\\//g, '/')
        .trim();
    if (url.substr(0, 2) === '//') {
        url = 'https:' + url;
    }
    return url;
}

function parse_url(url) {
    try {
        return new URL(url);
    } catch (err) {
        return null;
    }
}

function image_extension(url) {
    var parsed = parse_url(url),
        extension;

    if (!parsed) {
        return '.jpg';
    }

    extension = path.extname(parsed.pathname).toLowerCase();
    if (image_extensions[extension]) {
        return extension;
    }

    return '.jpg';
}

function sanitize_filename(filename) {
    return filename.replace(/[<>:"\\|?*\/]+/g, ' ');
}

function is_ebay_image_url(url) {
    var parsed = parse_url(url),
        extension;

    if (!parsed || !parsed.hostname.match(/(^|\.)ebayimg\.com$/i)) {
        return false;
    }

    extension = path.extname(parsed.pathname).toLowerCase();
    return !!image_extensions[extension];
}

function is_image_url(url) {
    var parsed = parse_url(url),
        extension;

    if (!parsed) {
        return false;
    }

    extension = path.extname(parsed.pathname).toLowerCase();
    return !!image_extensions[extension];
}

function normalize_ebay_image_url(url) {
    url = normalize_url(url);
    if (!is_ebay_image_url(url)) {
        return url;
    }

    return url
        .replace(/\/thumbs\/images\//i, '/images/')
        .replace(/\/s-l\d+(-[a-z0-9]+)?(\.(?:gif|jpe?g|png|webp))/i, '/s-l1600$2');
}

function normalize_gallery_webp_url(url) {
    var parsed;

    url = normalize_url(url);
    if (!is_ebay_image_url(url)) {
        return "";
    }

    parsed = parse_url(url);
    if (!parsed || !parsed.pathname.match(/\/(?:thumbs\/)?images\/g\/[^\/]+\/s-l\d+/i)) {
        return "";
    }

    return url
        .replace(/\/thumbs\/images\//i, '/images/')
        .replace(/\/s-l\d+(-[a-z0-9]+)?\.(?:gif|jpe?g|png|webp)/i, '/s-l1600.webp');
}

function once(callback) {
    var called = false;

    return function(err) {
        if (!called) {
            called = true;
            callback(err);
        }
    };
}

function get_ebay_picture(context, url, callback) {
    var filename = context.auction_data.filenames[url];
    var output = fs.createWriteStream(path.join('pictures', filename));
    var done = once(callback);
    var failed = false;
    var download = request({
        url: url,
        headers: request_headers
    });

    download
        .on('error', done)
        .on('response',
            function(response) {
                if (response.statusCode >= 400) {
                    failed = true;
                    done(new Error('Could not download ' + url + ': HTTP ' + response.statusCode));
                    download.abort();
                }
            })
        .pipe(output)
        .on('error', done)
        .on('finish',
            function() {
                if (!failed) {
                    done();
                }
            });
}

function add_url(data, context, url) {
    url = normalize_ebay_image_url(url);
    if (!url || !is_image_url(url) || data.filenames[url]) {
        return;
    }

    data.urls.push(url);
    var suffix = "-" + data.urls.length + image_extension(url);
    data.filenames[url] = sanitize_filename(context.name + " " + context.id + suffix);
}

function add_gallery_url(data, context, url) {
    url = normalize_gallery_webp_url(url);
    if (url) {
        add_url(data, context, url);
    }
}

function add_json_image_urls(data, context, value, add) {
    add = add || add_url;
    if (!value) {
        return;
    }

    if (typeof value === 'string') {
        add(data, context, value);
        return;
    }

    if (Array.isArray(value)) {
        value.forEach(
            function(item) {
                add_json_image_urls(data, context, item, add);
            });
        return;
    }

    if (typeof value === 'object') {
        Object.keys(value).forEach(
            function(key) {
                add_json_image_urls(data, context, value[key], add);
            });
    }
}

function add_srcset_urls(data, context, srcset) {
    if (!srcset) {
        return;
    }

    srcset.split(',').forEach(
        function(item) {
            add_url(data, context, item.trim().split(/\s+/)[0]);
        });
}

function add_image_attribute_urls($element, data, context, image_attributes) {
    image_attributes.forEach(
        function(attribute) {
            add_url(data, context, $element.attr(attribute));
        });

    add_srcset_urls(data, context, $element.attr('srcset'));
    add_srcset_urls(data, context, $element.attr('data-srcset'));
}

function add_gallery_srcset_urls(data, context, srcset) {
    if (!srcset) {
        return;
    }

    srcset.split(',').forEach(
        function(item) {
            add_gallery_url(data, context, item.trim().split(/\s+/)[0]);
        });
}

function add_gallery_image_attribute_urls($element, data, context, image_attributes) {
    image_attributes.forEach(
        function(attribute) {
            add_gallery_url(data, context, $element.attr(attribute));
        });

    add_gallery_srcset_urls(data, context, $element.attr('srcset'));
    add_gallery_srcset_urls(data, context, $element.attr('data-srcset'));
}

function scrape_listing_image_attributes($, data, context) {
    var image_attributes = [
        'data-image-src',
        'data-original',
        'data-src',
        'data-zoom-src',
        'src'
    ];

    $('.ux-image-grid img, .ux-image-grid source, .ux-image-carousel img, .ux-image-carousel source').each(
        function(i, element) {
            add_gallery_image_attribute_urls($(element), data, context, image_attributes);
        });
}

function scrape_legacy_picture_panel($, data, context) {
    var image_element = $('div#JSDF').html(),
        args_text,
        args,
        picturePanel,
        fsImageList;

    if (!image_element || image_element.indexOf('rwidgets(') === -1) {
        return;
    }

    args_text = text_between('rwidgets(', image_element, ');new (raptor');
    if (!args_text) {
        return;
    }

    args = parse_json(json_sanitize('[' + args_text + ']'));
    if (!args) {
        return;
    }

    picturePanel = args.filter(
        function(item) {
            return item[0] === 'ebay.viewItem.PicturePanel';
        })[0];

    if (!picturePanel || !picturePanel[2]) {
        return;
    }

    fsImageList = picturePanel[2]['fsImgList'];
    if (!fsImageList) {
        return;
    }

    fsImageList.forEach(
        function(item) {
            add_url(data, context, item['maxImageUrl'] || item['displayImgUrl']);
        });
}

function scrape_legacy_picture_model(data, context, html) {
    var picture_text = text_between('"PICTURE"', html, ')</script>'),
        args,
        mediaList;

    if (!picture_text) {
        return;
    }

    args = parse_json('{"p":"PICTURE"' + picture_text);
    if (!args || !args['w'] || !args['w'][0] || !args['w'][0][2]) {
        return;
    }

    mediaList = args['w'][0][2]['model']['mediaList'];
    if (!mediaList) {
        return;
    }

    mediaList.forEach(
        function(item) {
            if (item['image'] && item['image']['zoomImg']) {
                add_url(data, context, item['image']['zoomImg']['URL']);
            }
        });
}

function scrape_structured_image_data($, data, context) {
    $('script[type="application/ld+json"]').each(
        function(i, script) {
            var json = parse_json($(script).html());
            if (json && json['@type'] === 'Product') {
                add_json_image_urls(data, context, json.image, add_gallery_url);
            }
        });
}

function scrape_image_attributes($, data, context) {
    var image_attributes = [
        'content',
        'data-image-src',
        'data-original',
        'data-src',
        'data-zoom-src',
        'href',
        'src'
    ];

    $('a,img,link,meta,source').each(
        function(i, element) {
            add_image_attribute_urls($(element), data, context, image_attributes);
        });
}

function scrape_embedded_ebay_urls(data, context, html) {
    var normalized = normalize_url(html),
        pattern = /https?:\/\/(?:i\.)?ebayimg\.com\/(?:thumbs\/)?images\/g\/[^"'<>\\\s]+?\.(?:gif|jpe?g|png|webp)(?:\?[^"'<>\\\s]*)?/ig,
        match;

    while ((match = pattern.exec(normalized)) !== null) {
        add_url(data, context, match[0]);
    }
}

function scrape_auctiva_urls($, data, context) {
    $('img').each(
        function(i, img) {
            var src = $(this).attr('src');
            if (src && src.match(/img\.auctiva\.com\/.*_tp\./)) {
                src = src.replace("_tp.", "_o.");
                add_url(data, context, src);
            }
        });
}

function scrape_seller($) {
    var seller = $('div.ux-seller-section__item--seller').text();

    if (!seller) {
        seller = $('a[href*="/str/"]').first().text();
    }

    seller = seller.replace(/\s+/g, ' ').trim();
    if (seller.indexOf(' ') !== -1) {
        seller = seller.substr(0, seller.indexOf(' '));
    }

    return seller;
}

function scrape_data(context, html) {
    var $ = cheerio.load(html),
        data = {
            id: context.id,
            seller: "",
            urls: [],
            suffix: {},
            filenames: {}
        };

    data.seller = scrape_seller($);
    scrape_listing_image_attributes($, data, context);
    if (!data.urls.length) {
        scrape_legacy_picture_panel($, data, context);
    }
    if (!data.urls.length) {
        scrape_legacy_picture_model(data, context, html);
    }
    if (!data.urls.length) {
        scrape_structured_image_data($, data, context);
    }
    scrape_auctiva_urls($, data, context);

    return data;
}

function blocked_ebay_page(html) {
    return !html || !!html.match(/<title>Error Page \| eBay<\/title>|splashui\/challenge|Something went wrong on our end/i);
}

function set_auction_data_from_html(context, html) {
    context.auction_data = scrape_data(context, html);

    if (!context.auction_data.urls.length) {
        var err = new Error('Could not find any auction image URLs for ' + context.id);
        err.no_images = true;
        throw err;
    }
}

function fetch_auction_data_with_browser_mode(context, auction_url, options, callback) {
    browser.fetch_dom(auction_url, {
            user_agent: request_headers['User-Agent'],
            headless: options.headless,
            profile: options.profile,
            timeout: options.timeout,
            wait_expression: options.wait_expression,
            wait_after_load: options.wait_after_load
        },
        function(err, html) {
            var challenge_error;

            if (err) {
                callback(err);
                return;
            }

            if (blocked_ebay_page(html)) {
                challenge_error = new Error('Browser fetch reached an eBay challenge or error page for ' + context.id);
                challenge_error.browser_challenge = true;
                callback(challenge_error);
                return;
            }

            try {
                set_auction_data_from_html(context, html);
                callback();
            } catch (parse_err) {
                callback(parse_err);
            }
        });
}

function fetch_auction_data_with_browser(context, auction_url, original_error, callback) {
    console.log('eBay blocked the direct fetch; trying headless browser automation.');
    fetch_auction_data_with_browser_mode(context, auction_url, {
            headless: true,
            timeout: 30000
        },
        function(err) {
            var message;

            if (!err) {
                callback();
                return;
            }

            if (process.env.TERMINALS_BROWSER_HEADLESS_ONLY) {
                if (original_error) {
                    callback(new Error(original_error.message + '; browser fetch failed: ' + err.message));
                } else {
                    callback(err);
                }
                return;
            }

            message = 'Headless browser could not read the listing. Opening a visible browser; complete any eBay challenge if prompted.';
            if (!err.browser_challenge && !err.no_images) {
                console.log('Headless browser failed: ' + err.message);
            }
            console.log(message);
            console.log('Browser profile: ' + browser.default_profile());
            fetch_auction_data_with_browser_mode(context, auction_url, {
                    headless: false,
                    timeout: 300000,
                    wait_expression: "document.documentElement.outerHTML.indexOf('i.ebayimg.com') !== -1",
                    wait_after_load: 1000
                },
                function(visible_err) {
                    if (visible_err) {
                        if (original_error) {
                            callback(new Error(original_error.message + '; visible browser fetch failed: ' + visible_err.message));
                        } else {
                            callback(visible_err);
                        }
                    } else {
                        callback();
                    }
                });
        });
}

function get_auction_data(context, callback) {
    var auction_url = 'https://www.ebay.com/itm/' + context.id;

    request({
            url: auction_url,
            headers: request_headers
        },
        function(err, res, html) {
            var status_error;

            if (err) {
                fetch_auction_data_with_browser(context, auction_url, err, callback);
            } else if ((res && res.statusCode >= 400) || blocked_ebay_page(html)) {
                status_error = new Error('Could not fetch auction ' + context.id + ': HTTP ' + (res && res.statusCode));
                fetch_auction_data_with_browser(context, auction_url, status_error, callback);
            } else {
                try {
                    set_auction_data_from_html(context, html);
                } catch (parse_err) {
                    fetch_auction_data_with_browser(context, auction_url, parse_err, callback);
                    return;
                }
                callback();
            }
        });
}

exports.get_auction_data = get_auction_data;
exports.get_ebay_picture = get_ebay_picture;
exports.scrape_data = scrape_data;
