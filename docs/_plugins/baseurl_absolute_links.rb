# frozen_string_literal: true
#
# Prepend site.baseurl to root-absolute in-content links and asset refs that
# are missing it.
#
# Why this exists
# ---------------
# The site is served under a baseurl ("/street"). The theme/nav and anything
# built with the `relative_url` filter already emit "/street/...". But many
# in-content Markdown links were authored as root-absolute paths like
# "/examples/rest-api/" (no baseurl). Those render verbatim, so clicking one
# sends the visitor to "https://<host>/examples/rest-api/" — missing "/street"
# — which 404s. This hook normalizes them at build time, fixing the whole class
# at once (and for future pages) instead of editing every link by hand.
#
# Safety
# ------
# - Only runs when a non-empty baseurl is configured.
# - Only touches rendered HTML output (output_ext == ".html").
# - Only rewrites href/src values that start with a single "/" AND do not
#   already start with the baseurl. So "/street/..." (theme, nav, assets,
#   the hardcoded landing-page links) are left untouched — no double prefix.
# - Protocol-relative ("//cdn...") and absolute ("https://...", "#anchor",
#   "mailto:") values never match the pattern, so they are left alone.

module StreetDocs
  module BaseurlAbsoluteLinks
    # href="/path" or src='/path'  — capturing attr, quote, and the path.
    # (?!\/) ensures we do not match protocol-relative "//host" URLs.
    PATTERN = /\b(href|src)=("|')(\/(?!\/)[^"']*)\2/.freeze

    def self.rewrite(html, baseurl)
      html.gsub(PATTERN) do
        attr  = Regexp.last_match(1)
        quote = Regexp.last_match(2)
        path  = Regexp.last_match(3)

        if path == baseurl || path.start_with?("#{baseurl}/")
          # Already baseurl-prefixed — leave it exactly as-is.
          "#{attr}=#{quote}#{path}#{quote}"
        else
          "#{attr}=#{quote}#{baseurl}#{path}#{quote}"
        end
      end
    end
  end
end

Jekyll::Hooks.register [:pages, :documents], :post_render do |item|
  site = item.site
  baseurl = site.config["baseurl"].to_s
  next if baseurl.empty?

  # Only rewrite HTML output. Skips sitemap.xml, feed.xml, JSON, etc.
  ext = item.respond_to?(:output_ext) ? item.output_ext : nil
  next unless ext == ".html"
  next if item.output.nil?

  item.output = StreetDocs::BaseurlAbsoluteLinks.rewrite(item.output, baseurl)
end
