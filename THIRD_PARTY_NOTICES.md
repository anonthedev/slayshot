# Third-party notices

Slayshot depends on open-source projects distributed under their own licenses.
Dependency manifests remain the authoritative list of packages:

- `frontend/package.json` and `frontend/pnpm-lock.yaml`
- `backend/requirements.txt`

## LR-ASD

Active-speaker detection is provided by the
[LR-ASD](https://github.com/Junhua-Liao/LR-ASD) Git submodule in
`backend/asd`. It is licensed under the MIT License; its copyright notice is
preserved in `backend/asd/LICENSE`.

If you use the active-speaker pipeline in academic work, cite:

- Junhua Liao et al., “A Light Weight Model for Active Speaker Detection,”
  CVPR 2023.
- Junhua Liao et al., “LR-ASD: Lightweight and Robust Network for Active
  Speaker Detection,” IJCV 2025.

Full citations and acknowledgements are available in `backend/asd/README.md`.
The tracked patch in `backend/patches/` replaces deprecated `numpy.int` usage
during the Modal image build without modifying the upstream submodule.

## WhisperX

Transcription and word-level alignment use
[WhisperX](https://github.com/m-bain/whisperX). Review its repository license
and the licenses and terms of the model weights selected at runtime.

## Fonts

The backend image downloads Anton and Montserrat during its Modal build. Both
font families are distributed under the SIL Open Font License. Their upstream
repositories remain the source of the font files and license terms.

## Models and hosted services

WhisperX, PyTorch, Transformers, Google Gemini, Supabase, AWS, Modal,
Inngest, Polar, and YouTube are governed by their respective licenses and
service terms. Operators are responsible for reviewing those terms and for
obtaining rights to process, store, and publish uploaded media.
