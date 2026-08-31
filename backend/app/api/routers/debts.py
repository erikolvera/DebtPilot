"""Debts CRUD.

Every handler resolves the user from the verified token, opens one
user-scoped transaction, and delegates to the repository.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..auth import current_user_id
from ..db import user_scoped_connection
from ..repositories import debts as repo
from ..schemas import DebtCreate, DebtOut, DebtUpdate

router = APIRouter()

NOT_FOUND = "debt not found"


# Plain `def`, not `async def`: these handlers do blocking database work, so
# FastAPI runs them in a threadpool instead of stalling the event loop.
@router.post("/debts", response_model=DebtOut, status_code=status.HTTP_201_CREATED)
def create_debt(data: DebtCreate, user_id: str = Depends(current_user_id)) -> DebtOut:
    with user_scoped_connection(user_id) as conn:
        row = repo.create_debt(conn, user_id, data)
    return DebtOut.model_validate(row._mapping)


@router.get("/debts", response_model=list[DebtOut])
def list_debts(user_id: str = Depends(current_user_id)) -> list[DebtOut]:
    with user_scoped_connection(user_id) as conn:
        rows = repo.list_debts(conn, user_id)
    return [DebtOut.model_validate(row._mapping) for row in rows]


@router.patch("/debts/{debt_id}", response_model=DebtOut)
def update_debt(
    debt_id: str, changes: DebtUpdate, user_id: str = Depends(current_user_id)
) -> DebtOut:
    with user_scoped_connection(user_id) as conn:
        row = repo.update_debt(conn, user_id, debt_id, changes)
    if row is None:
        # 404 for both "no such debt" and "not yours": distinguishing them
        # would confirm the row exists in another account.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return DebtOut.model_validate(row._mapping)


@router.delete("/debts/{debt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_debt(debt_id: str, user_id: str = Depends(current_user_id)) -> Response:
    with user_scoped_connection(user_id) as conn:
        deleted = repo.delete_debt(conn, user_id, debt_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
