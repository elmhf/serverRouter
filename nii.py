from flask import Flask, send_file, request
import nibabel as nib
import numpy as np
import matplotlib.pyplot as plt
import io

app = Flask(__name__)
nii_file = ""  # path لملف NIfTI

@app.route("/slice")
def get_slice():
    index = int(request.args.get("index", 100))
    view = request.args.get("view", "axial")

    img = nib.load(nii_file)
    data = img.get_fdata()

    if view == "axial":
        slice_img = data[:, :, index]
    elif view == "sagittal":
        slice_img = data[index, :, :]
    elif view == "coronal":
        slice_img = data[:, index, :]
    else:
        return "Invalid view", 400

    fig, ax = plt.subplots()
    ax.imshow(np.rot90(slice_img), cmap="gray")
    ax.axis("off")

    buf = io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight", pad_inches=0)
    buf.seek(0)
    plt.close(fig)
    return send_file(buf, mimetype="image/png")

if __name__ == "__main__":
    app.run(debug=True)
