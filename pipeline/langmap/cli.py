"""Command line: ``uv run langmap build`` regenerates the committed data pack."""

from __future__ import annotations

import argparse
import logging
import time
import warnings
from pathlib import Path

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
    a = sub.add_parser("audio", help="say every word and sentence into data/<pack>/audio")
    a.add_argument("--pack", default="zh-en")
    a.add_argument("--shard", default="0/1", help="i/N: only clips whose name hash is i mod N")
    a.add_argument("--limit", type=int, help="at most this many clips (for trying things out)")
    a.add_argument("--force", action="store_true", help="redo clips that already exist")
    a.add_argument("--threads", type=int, default=0)
    p = sub.add_parser("audio-pack", help="check all clips exist; write audio/index.json and a tar")
    p.add_argument("--pack", default="zh-en")
    p.add_argument("--tar", type=Path, help="also write audio/ to this tar and print its sha256")
    c = sub.add_parser("audio-check", help="score the voice: recogniser error and tone contrast")
    c.add_argument("--pack", default="zh-en")
    c.add_argument("--voice")
    c.add_argument("--sample", type=int, default=40)
    args = parser.parse_args()
    if args.cmd == "build":
        build(args.pack, preview=not args.no_preview)
    elif args.cmd == "fetch":
        from .sources import fetch_all

        for name, path in fetch_all().items():
            print(f"{name}: {path}")
    elif args.cmd == "audio":
        from .audio import generate

        i, n = (int(x) for x in args.shard.split("/"))
        done = generate(DATA_DIR / args.pack, (i, n), args.limit, args.force, args.threads)
        print(f"[audio] wrote {done} clips")
    elif args.cmd == "audio-pack":
        from .audio import make_tarball, write_index

        print(f"[audio] index: {write_index(DATA_DIR / args.pack)}")
        if args.tar:
            print(f"[audio] {args.tar} sha256 {make_tarball(DATA_DIR / args.pack, args.tar)}")
    elif args.cmd == "audio-check":
        from .audio import VOICE, pack_clips
        from .audio_check import check

        clips = pack_clips(DATA_DIR / args.pack)
        print(check(clips, args.voice or VOICE, args.sample))


if __name__ == "__main__":
    main()
