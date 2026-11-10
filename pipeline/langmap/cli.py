"""Command line: ``uv run langmap build`` regenerates the committed data pack."""

from __future__ import annotations

import argparse
import logging
import time
import warnings

from .paths import DATA_DIR, REPORTS_DIR


def build(pack: str = "zh-en", preview: bool = True) -> None:
    import jieba

    jieba.setLogLevel(logging.WARNING)
    from .embed import dump_stats, embed_words, embedding_digest
    from .export import export_pack, write_report
    from .relate import anchors, semantic_neighbors
    from .sentences import select_sentences
    from .themes import assign_themes, load_place_labels, load_theme_config
    from .words import char_levels, legacy_id_map, load_words
    from .world import build_world, world_stats

    t0 = time.time()

    def step(msg: str) -> None:
        print(f"[{time.time() - t0:6.1f}s] {msg}", flush=True)

    words = load_words()
    legacy = legacy_id_map(words)
    step(f"words: {len(words)} (legacy ids mapped: {len(legacy)})")
    cfg = load_theme_config(pack)
    themes = cfg["themes"]
    emb, emb_stats = embed_words(words, themes)
    step(f"embeddings: {dump_stats(emb_stats)} digest={embedding_digest(emb)}")
    theme, _ = assign_themes(words, emb, cfg, emb_stats["vectors"])
    step("themes assigned")
    neighbors = semantic_neighbors(emb)
    anchor, _ = anchors(words, emb, theme)
    step("relations computed")
    world = build_world(words, emb, theme, anchor, neighbors, themes, load_place_labels(pack))
    step(f"world: {len(world.regions)} regions, {world_stats(world, words)}")
    sentences, by_word, sstats = select_sentences(words, char_levels(words))
    step(f"sentences: {sstats['sentences_used']}")

    stats = {
        "embedding": {k: v for k, v in emb_stats.items() if k != "vectors"},
        "sentences": sstats,
    }
    out_dir = DATA_DIR / pack
    manifest = export_pack(
        out_dir, words, theme, anchor, neighbors, world, themes, sentences, by_word, legacy, stats
    )
    write_report(REPORTS_DIR / f"{pack}.md", words, theme, world, themes, manifest)
    step(f"wrote {out_dir} (contentHash={manifest['contentHash']})")
    if preview:
        from .preview import render_closeup, render_preview

        hanzi = [w.hanzi for w in words]
        render_preview(REPORTS_DIR / f"{pack}-preview.png", world, theme, themes)
        render_closeup(REPORTS_DIR / f"{pack}-closeup.png", world, hanzi)
        step("previews rendered")


def main() -> None:
    warnings.filterwarnings("ignore", category=SyntaxWarning)
    parser = argparse.ArgumentParser(prog="langmap")
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="regenerate data/<pack> from pinned sources")
    b.add_argument("--pack", default="zh-en")
    b.add_argument("--no-preview", action="store_true")
    sub.add_parser("fetch", help="download and verify all pinned sources")
    args = parser.parse_args()
    if args.cmd == "build":
        build(args.pack, preview=not args.no_preview)
    elif args.cmd == "fetch":
        from .sources import fetch_all

        for name, path in fetch_all().items():
            print(f"{name}: {path}")


if __name__ == "__main__":
    main()
