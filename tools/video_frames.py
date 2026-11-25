# Turns Lorcan's phone videos into whole-frame finder photos (25 Nov: the Nothing video round).
#   python3 tools/video_frames.py nothing CLIP.MOV [CLIP2.MOV ...]   every frame is "no chocolate here": filed straight into
#                                                                    training-photos-wide/none/ with no box
#   python3 tools/video_frames.py mixed CLIP.MOV [...]               frames that go between nothing and chocolates: cut into
#                                                                    experiments/video-mixed/<clip>/, then boxed by today's finder
#                                                                    with tools/video_label.js (sure ones only) and checked by eye
#   add --hold to keep a clip OUT of training: its frames go to experiments/video-held/<clip>/ for training/nothing_eval.js
# Frames: 2 per second (neighbouring frames are near-identical), the centre square of the picture across its full width,
# like the scanner's own view, saved at 640 px.
import json, os, subprocess, sys, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if a != "--hold"]; hold = "--hold" in sys.argv
if len(args) < 2 or args[0] not in ("nothing", "mixed"): sys.exit(__doc__ if __doc__ else "usage: video_frames.py nothing|mixed CLIP... [--hold]")
kind, clips = args[0], args[1:]
for clip in clips:
    name = os.path.splitext(os.path.basename(clip))[0].replace(" ", "_")
    if hold: out = os.path.join(ROOT, "experiments/video-held", name)
    elif kind == "nothing": out = os.path.join(ROOT, "training-photos-wide/none")
    else: out = os.path.join(ROOT, "experiments/video-mixed", name)
    os.makedirs(out, exist_ok=True)
    pattern = os.path.join(out, f"vid_{name}_%04d.jpg")
    if glob.glob(os.path.join(out, f"vid_{name}_*.jpg")): print(f"{name}: already cut, skipped"); continue
    subprocess.run(["ffmpeg", "-loglevel", "error", "-i", clip, "-vf", "fps=2,crop='min(iw,ih)':'min(iw,ih)',scale=640:640", "-q:v", "3", pattern], check=True)
    files = sorted(glob.glob(os.path.join(out, f"vid_{name}_*.jpg")))
    if kind == "nothing" and not hold:
        bp = os.path.join(ROOT, "training-photos-wide/boxes.json"); boxes = json.load(open(bp))
        for f in files: boxes[f"none/{os.path.basename(f)}"] = None
        json.dump(boxes, open(bp, "w"), indent=1)
    print(f"{name}: {len(files)} frames -> {os.path.relpath(out, ROOT)}")
