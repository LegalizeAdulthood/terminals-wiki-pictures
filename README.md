This is a simple nodejs script to take pictures of terminals from ebay auctions and upload them to the [terminals wiki](http://terminals.classiccmp.org) with an appropriate source citation.

The script identifies the common ways that photos are included with auctions to identify the photo URLs.  It then downloads the photos locally into the "pictures" folder, naming them on the manufacturer, model and ebay auction number given on the command-line.  The photos are uploaded to the wiki directly from their URLs.  They are added to the wiki page for the given manufacturer and model name.  If no such page exists, or no existing images section exists, then the appropriate wiki markup will be created.

The script must be provided with login credentials in order to be able to make edits to the wiki.  Example:

```
> node terminals.js JQPublic FoobieBletch 251594107719 IBM 3278
```
