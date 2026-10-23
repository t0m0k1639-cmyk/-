"""ページのデータをパスワードで暗号化する。

ブラウザの Web Crypto で復号できる形式にしている:
PBKDF2-HMAC-SHA256 で鍵を作り、AES-256-GCM で暗号化（暗号文の末尾に認証タグ）。
"""
from __future__ import annotations

import base64
import json
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 250_000


def _key(password: str, salt: bytes, iterations: int) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return kdf.derive(password.encode())


def encrypt(obj, password: str) -> dict:
    salt, iv = os.urandom(16), os.urandom(12)
    plain = json.dumps(obj, ensure_ascii=False).encode()
    ct = AESGCM(_key(password, salt, ITERATIONS)).encrypt(iv, plain, None)
    b64 = lambda b: base64.b64encode(b).decode()
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITERATIONS,
            "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def decrypt(env: dict, password: str):
    d = lambda k: base64.b64decode(env[k])
    plain = AESGCM(_key(password, d("salt"), env["iter"])).decrypt(d("iv"), d("ct"), None)
    return json.loads(plain)
