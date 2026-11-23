<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  exclude-result-prefixes="s">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <title>XML Sitemap — eisymyanmar.com</title>
        <style>
          body { font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 24px; color: #111; background: #fafafa; }
          h1 { font: 600 18px/1.3 system-ui, sans-serif; margin: 0 0 8px; }
          p { font: 13px/1.4 system-ui, sans-serif; color: #444; margin: 0 0 16px; }
          pre { background: #fff; border: 1px solid #ddd; padding: 16px; overflow: auto; white-space: pre-wrap; word-break: break-all; }
          .tag { color: #0550ae; }
          .text { color: #0a3069; }
        </style>
      </head>
      <body>
        <h1>XML Sitemap</h1>
        <p>Raw sitemap document (crawlers read the underlying XML; this stylesheet is display-only).</p>
        <pre>
          <span class="tag">&lt;?xml version="1.0" encoding="UTF-8"?&gt;</span>
          <xsl:text>&#10;</xsl:text>
          <span class="tag">&lt;urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"&gt;</span>
          <xsl:text>&#10;</xsl:text>
          <xsl:for-each select="//s:url | //url">
            <span class="tag">  &lt;url&gt;</span><xsl:text>&#10;</xsl:text>
            <span class="tag">    &lt;loc&gt;</span><span class="text"><xsl:value-of select="s:loc | loc"/></span><span class="tag">&lt;/loc&gt;</span><xsl:text>&#10;</xsl:text>
            <xsl:if test="s:lastmod | lastmod">
              <span class="tag">    &lt;lastmod&gt;</span><span class="text"><xsl:value-of select="s:lastmod | lastmod"/></span><span class="tag">&lt;/lastmod&gt;</span><xsl:text>&#10;</xsl:text>
            </xsl:if>
            <xsl:if test="s:changefreq | changefreq">
              <span class="tag">    &lt;changefreq&gt;</span><span class="text"><xsl:value-of select="s:changefreq | changefreq"/></span><span class="tag">&lt;/changefreq&gt;</span><xsl:text>&#10;</xsl:text>
            </xsl:if>
            <xsl:if test="s:priority | priority">
              <span class="tag">    &lt;priority&gt;</span><span class="text"><xsl:value-of select="s:priority | priority"/></span><span class="tag">&lt;/priority&gt;</span><xsl:text>&#10;</xsl:text>
            </xsl:if>
            <span class="tag">  &lt;/url&gt;</span><xsl:text>&#10;</xsl:text>
          </xsl:for-each>
          <span class="tag">&lt;/urlset&gt;</span>
        </pre>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
