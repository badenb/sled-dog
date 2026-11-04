"""Frozen entry point; deliberately bypass the source-checkout launcher."""
from sled_dog.cli import main
raise SystemExit(main())
