"""Remove floating fragments from Pixal3D GLBs. Runs ON the GPU VM (heavy on RAM; never run locally):

  python ~/pixal3d_clean.py ~/jobs/out ~/jobs/clean [--strict] [--only planet_]

Pixal3D occasionally emits small detached pieces (stray flowers, pebbles, specks) floating near the model.
Its export splits vertices along UV seams, so connectivity is computed on a copy welded by POSITION only;
the face labels are then applied to the original mesh, keeping its UVs/texture intact.
Kept: the largest piece, plus any piece that is big (>= 3% of faces) or actually touches the main piece's
surface (nearest vertex within 1.5% of the model size). Floating bits inside the bounding box are dropped too.
--strict (use for planets): size doesn't matter, every piece must touch the main surface.
--only PREFIX: process only files whose name starts with PREFIX. Prints one line per model.
"""
import glob
import os
import sys

import numpy as np
import trimesh
from scipy.spatial import cKDTree

src, dst = sys.argv[1], sys.argv[2]
STRICT = '--strict' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else ''
os.makedirs(dst, exist_ok=True)
for path in sorted(glob.glob(os.path.join(src, f"{ONLY}*.glb"))):
    name = os.path.basename(path)
    out = os.path.join(dst, name)
    scene = trimesh.load(path)
    report = []
    for key, g in list(scene.geometry.items()):
        welded = trimesh.Trimesh(g.vertices.copy(), g.faces.copy(), process=False)
        welded.merge_vertices(merge_tex=True, merge_norm=True)          # face order is preserved
        labels = trimesh.graph.connected_component_labels(welded.face_adjacency, node_count=len(welded.faces))
        ids, counts = np.unique(labels, return_counts=True)
        main = ids[np.argmax(counts)]
        mv = welded.vertices[np.unique(welded.faces[labels == main])]
        tree = cKDTree(mv)
        tol = 0.015 * np.linalg.norm(mv.max(0) - mv.min(0))
        keep = np.zeros(len(ids), bool)
        for j, (i, c) in enumerate(zip(ids, counts)):
            if i == main or (not STRICT and c >= 0.03 * len(welded.faces)):
                keep[j] = True
                continue
            v = welded.vertices[np.unique(welded.faces[labels == i])]
            keep[j] = tree.query(v, k=1)[0].min() <= tol     # touches the main surface
        mask = keep[np.searchsorted(ids, labels)]
        if not mask.all():
            g.update_faces(mask)
            g.remove_unreferenced_vertices()
        report.append(f"{len(ids)} piece(s), dropped {int((~keep).sum())} ({int((~mask).sum())} faces)")
    scene.export(out)
    print(f"{name:24s} {'; '.join(report)}", flush=True)
print("CLEAN DONE", flush=True)
