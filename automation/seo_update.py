import os
import re
import json
from datetime import datetime

# 設定
BASE_URL = "https://yamazaki2357.github.io"
SITE_NAME = "AI情報ブログ"
LOGO_URL = f"{BASE_URL}/assets/img/logo.svg"
TARGET_DIR = "/Users/yamazaki/Development/AI情報ブログ"

def get_relative_path(file_path):
    return os.path.relpath(file_path, TARGET_DIR)

def get_canonical_url(relative_path):
    # WindowsパスセパレータをURL用に変換
    path = relative_path.replace(os.sep, '/')
    return f"{BASE_URL}/{path}"

def resolve_image_url(relative_image_path, file_path):
    if not relative_image_path:
        return LOGO_URL
    
    if relative_image_path.startswith('http'):
        return relative_image_path
        
    # ファイルからの相対パスを絶対パス（ドメイン付き）に変換
    file_dir = os.path.dirname(file_path)
    abs_image_path = os.path.normpath(os.path.join(file_dir, relative_image_path))
    rel_image_path = os.path.relpath(abs_image_path, TARGET_DIR)
    return f"{BASE_URL}/{rel_image_path.replace(os.sep, '/')}"

def create_json_ld(meta_data, canonical_url, is_article=True):
    schema = {
        "@context": "https://schema.org",
        "@type": "BlogPosting" if is_article else "WebSite",
        "mainEntityOfPage": {
            "@type": "WebPage",
            "@id": canonical_url
        },
        "headline": meta_data.get('title', SITE_NAME),
        "description": meta_data.get('description', ''),
        "image": meta_data.get('image', LOGO_URL),
        "author": {
            "@type": "Organization",
            "name": SITE_NAME,
            "url": BASE_URL
        },
        "publisher": {
            "@type": "Organization",
            "name": SITE_NAME,
            "logo": {
                "@type": "ImageObject",
                "url": LOGO_URL
            }
        }
    }

    if is_article:
        if meta_data.get('published_time'):
            schema["datePublished"] = meta_data['published_time']
        # dateModifiedがあれば追加したいが、現状はないので省略

    return json.dumps(schema, ensure_ascii=False, indent=2)

def process_file(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # メタデータの抽出
    title_match = re.search(r'<title>(.*?)</title>', content)
    desc_match = re.search(r'<meta\s+name="description"\s+content="(.*?)"', content, re.DOTALL)
    og_image_match = re.search(r'<meta\s+property="og:image"\s+content="(.*?)"', content)
    pub_time_match = re.search(r'<meta\s+property="article:published_time"\s+content="(.*?)"', content)

    meta_data = {
        'title': title_match.group(1).split('|')[0].strip() if title_match else SITE_NAME,
        'description': desc_match.group(1).replace('\n', '').strip() if desc_match else '',
        'image': resolve_image_url(og_image_match.group(1), file_path) if og_image_match else LOGO_URL,
        'published_time': pub_time_match.group(1) if pub_time_match else None
    }

    rel_path = get_relative_path(file_path)
    canonical_url = get_canonical_url(rel_path)
    
    is_article = '/posts/' in file_path

    # 変更フラグ
    modified = False

    # 1. Canonicalタグの追加
    if '<link rel="canonical"' not in content:
        canonical_tag = f'  <link rel="canonical" href="{canonical_url}">'
        # </title>の直後に追加
        content = re.sub(r'(</title>)', f'\\1\n{canonical_tag}', content)
        modified = True
        print(f"Added canonical to: {rel_path}")

    # 2. JSON-LDの追加
    if 'application/ld+json' not in content:
        json_ld = create_json_ld(meta_data, canonical_url, is_article)
        script_tag = f'\n  <script type="application/ld+json">\n{json_ld}\n  </script>'
        # </head>の直前に追加
        content = re.sub(r'(\s*</head>)', f'{script_tag}\\1', content)
        modified = True
        print(f"Added JSON-LD to: {rel_path}")

    if modified:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)

def main():
    # 対象とする拡張子
    target_exts = ['.html']
    
    # 除外するディレクトリ
    exclude_dirs = ['node_modules', '.git', '.agent', 'dist']

    for root, dirs, files in os.walk(TARGET_DIR):
        # 除外ディレクトリをスキップ
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        
        for file in files:
            if any(file.endswith(ext) for ext in target_exts):
                file_path = os.path.join(root, file)
                # テンプレートファイルなどは除外（必要に応じて調整）
                if 'article-templates' in file_path:
                    continue
                
                try:
                    process_file(file_path)
                except Exception as e:
                    print(f"Error processing {file_path}: {e}")

if __name__ == "__main__":
    main()
