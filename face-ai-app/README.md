# Face AI Detector

Real-time face detection and expression, age, and gender estimates run entirely in the browser with `face-api.js`.

## Model files

Download the face-api.js model weights and place these exact files directly in `public/models/` (not in an extra nested directory):

- `tiny_face_detector_model-weights_manifest.json`
- `tiny_face_detector_model-shard1`
- `face_expression_model-weights_manifest.json`
- `face_expression_model-shard1`
- `age_gender_model-weights_manifest.json`
- `age_gender_model-shard1`

The app loads them from `/models`. Start the app with `npm run dev`, open `http://localhost:3000`, and allow camera access. Webcam access requires localhost or HTTPS. If model loading fails, confirm every manifest and shard is present with its original filename, then use the retry button.
