# Project Rules

This file contains rules and guidelines for maintaining the AI Information Blog project.

## Article Updates

When updating an existing blog post or creating a new one manually:

1.  **Update `data/posts.json`**:
    -   Ensure the metadata in `data/posts.json` matches the content of the article.
    -   Specifically, check the `title`, `summary`, `tags`, and `image` fields.
    -   If you add a new image to the article, update the `image.src` path in `posts.json` to reflect the new image (e.g., the hero image).

2.  **Image Assets**:
    -   Store article-specific images in `assets/img/posts/YYYY-MM-DD/`.
    -   Ensure images are optimized and properly referenced in both the HTML file and `posts.json`.

3.  **Consistency**:
    -   The `index.html` (article list) relies on `data/posts.json` (via JavaScript) to display article cards. Failing to update `posts.json` will result in a mismatch between the list view and the actual article content.
