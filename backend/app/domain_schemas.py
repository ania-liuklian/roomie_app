from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, StringConstraints, model_validator

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Id = Annotated[int, Field(strict=True, gt=0)]
Amount = Annotated[int, Field(strict=True, gt=0, le=10**12)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChoreCreate(Input):
    title: Title
    owner_id: Id
    difficulty: Annotated[int, Field(strict=True, ge=1, le=5)] = 3
    due_at: AwareDatetime
    repeat: Literal["once", "weekly"] = "once"
    rotation: Literal["same", "rotate"] = "same"
    rotation_ids: list[Id] = Field(default_factory=list, max_length=100)


class ChoreEdit(Input):
    title: Title | None = None
    owner_id: Id | None = None
    difficulty: Annotated[int, Field(strict=True, ge=1, le=5)] | None = None
    due_at: AwareDatetime | None = None
    repeat: Literal["once", "weekly"] | None = None
    rotation: Literal["same", "rotate"] | None = None
    rotation_ids: list[Id] | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def reject_nulls(self):
        if any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Edited fields cannot be null")
        return self


class ShoppingCreate(Input):
    title: Title


class ShoppingEdit(Input):
    title: Title | None = None
    done: StrictBool | None = None

    @model_validator(mode="after")
    def reject_nulls(self):
        if any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Edited fields cannot be null")
        return self


class ExpenseCreate(Input):
    title: Title
    amount_minor: Amount
    participant_ids: list[Id] = Field(min_length=1, max_length=100)
    note: str = Field(default="", max_length=5000)
    occurred_at: AwareDatetime | None = None


class ExpenseEdit(Input):
    title: Title | None = None
    amount_minor: Amount | None = None
    participant_ids: list[Id] | None = Field(default=None, min_length=1, max_length=100)
    note: str | None = Field(default=None, max_length=5000)
    occurred_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def reject_nulls(self):
        if any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Edited fields cannot be null")
        return self


class SettlementCreate(Input):
    creditor_id: Id
    amount_minor: Amount
