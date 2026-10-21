from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/items", tags=["items"])


class ItemInput(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""


class IdInput(BaseModel):
    id: int = Field(gt=0, strict=True)


class UpdateInput(ItemInput):
    id: int = Field(gt=0, strict=True)


class Item(ItemInput):
    id: int


_items = {}
_sequence = 0


def reset_items():
    global _sequence
    _items.clear()
    _sequence = 0


@router.get("")
def list_items():
    return list(_items.values())


@router.get("/{item_id}")
def get_item(item_id: int):
    item = _items.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="not found")
    return item


@router.post("", status_code=201)
def create_item(payload: ItemInput):
    global _sequence
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="name is required")
    _sequence += 1
    item = Item(id=_sequence, name=payload.name.strip(), description=payload.description)
    _items[item.id] = item
    return item


@router.post("/update")
def update_item(payload: UpdateInput):
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="name is required")
    if payload.id not in _items:
        raise HTTPException(status_code=404, detail="not found")
    item = Item(id=payload.id, name=payload.name.strip(), description=payload.description)
    _items[payload.id] = item
    return item


@router.post("/delete")
def delete_item(payload: IdInput):
    if payload.id not in _items:
        raise HTTPException(status_code=404, detail="not found")
    del _items[payload.id]
    return {"id": payload.id, "deleted": True}
